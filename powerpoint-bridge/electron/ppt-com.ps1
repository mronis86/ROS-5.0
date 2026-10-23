param(
  [Parameter(Mandatory = $true)][string]$Command,
  [string]$OutDir = '',
  [string]$FilePath = '',
  [string]$ClosePath = '',
  [int]$SlideIndex = 0
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Write-Json($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 8
  [Console]::Out.Write($json)
}

function Friendly-ComError($msg) {
  $text = [string]$msg
  if ($text -match 'E_FAIL|COMException|InteropServices') {
    return 'PowerPoint refused the COM call (E_FAIL). Close any PowerPoint dialog or Protected View, then Follow loaded cue again.'
  }
  return $text
}

function Get-PptApp {
  try {
    return [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
  } catch {
    return $null
  }
}

function Ensure-PptApp {
  $app = Get-PptApp
  if ($app) { return $app }
  $app = New-Object -ComObject PowerPoint.Application
  try { $app.Visible = $true } catch {
    try { $app.Visible = -1 } catch {}
  }
  return $app
}

function Get-SlideTitle($slide) {
  try {
    $t = $slide.Shapes.Title.TextFrame.TextRange.Text
    if ($t) { return (($t -replace '[\r\n]+', ' ').Trim()) }
  } catch {}
  try {
    foreach ($shape in $slide.Shapes) {
      if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
        $t = $shape.TextFrame.TextRange.Text
        if ($t) { return (($t -replace '[\r\n]+', ' ').Trim()) }
      }
    }
  } catch {}
  return ''
}

function Normalize-Path($p) {
  if (-not $p) { return '' }
  try { return ([IO.Path]::GetFullPath($p)).ToLowerInvariant() } catch { return ([string]$p).ToLowerInvariant() }
}

function Find-Presentation($app, $path) {
  $want = Normalize-Path $path
  if (-not $want) { return $null }
  foreach ($p in @($app.Presentations)) {
    try {
      if ((Normalize-Path $p.FullName) -eq $want) { return $p }
    } catch {}
    try {
      if (([string]$p.Name).ToLowerInvariant() -eq [IO.Path]::GetFileName($path).ToLowerInvariant()) { return $p }
    } catch {}
  }
  return $null
}

function Live-Payload($app, $pres) {
  $showActive = $false
  $slideId = $null
  $index = $null
  $title = ''
  try {
    if ($app.SlideShowWindows.Count -gt 0) {
      $showActive = $true
      $slide = $app.SlideShowWindows.Item(1).View.Slide
      $slideId = [string][int]$slide.SlideID
      $index = [int]$slide.SlideIndex
      $title = Get-SlideTitle $slide
    }
  } catch {}
  $deckName = ''
  $slideCount = 0
  $fullName = ''
  if ($pres) {
    $deckName = [string]$pres.Name
    try { $slideCount = [int]$pres.Slides.Count } catch {}
    try { $fullName = [string]$pres.FullName } catch {}
  }
  return @{
    ok = $true
    slideshowActive = $showActive
    pptSlideId = $slideId
    slideIndex = $index
    title = $title
    deckName = $deckName
    slideCount = $slideCount
    fullName = $fullName
  }
}

function Unblock-Deck($path) {
  if (-not $path) { return }
  try { Unblock-File -LiteralPath $path -ErrorAction SilentlyContinue } catch {}
}

function Try-ProtectedView($app, $path) {
  try {
    foreach ($pv in @($app.ProtectedViewWindows)) {
      $source = ''
      try { $source = [string]$pv.SourcePath } catch {}
      try { if (-not $source) { $source = [string]$pv.Presentation.FullName } } catch {}
      if ($source -and ((Normalize-Path $source) -eq (Normalize-Path $path))) {
        return $pv.Edit('')
      }
      try {
        if (([string]$pv.Caption -replace ' \[Protected View\]$', '') -eq [IO.Path]::GetFileName($path)) {
          return $pv.Edit('')
        }
      } catch {}
    }
  } catch {}
  return $null
}

function Close-OtherPresentations($app, $keepPath) {
  $keep = Normalize-Path $keepPath
  foreach ($p in @($app.Presentations)) {
    try {
      if ($keep -and ((Normalize-Path $p.FullName) -eq $keep)) { continue }
      Close-Presentation $app $p
    } catch {}
  }
}

function Copy-DeckForOpen($path) {
  $ext = [IO.Path]::GetExtension($path)
  if (-not $ext) { $ext = '.pptx' }
  $dest = Join-Path $env:TEMP ("ros-ppt-open" + $ext)
  try {
    Copy-Item -LiteralPath $path -Destination $dest -Force
    Unblock-Deck $dest
    return $dest
  } catch {
    return $path
  }
}

function Try-OpenPath($app, $path) {
  $existing = Find-Presentation $app $path
  if ($existing) { return $existing }
  $fromPv = Try-ProtectedView $app $path
  if ($fromPv) { return $fromPv }
  try { return $app.Presentations.Open($path, $false, $false, $true) } catch {}
  try { return $app.Presentations.Open($path) } catch {}
  return $null
}

function Open-Presentation($app, $path) {
  Unblock-Deck $path
  Exit-Shows $app
  Start-Sleep -Milliseconds 200
  Close-OtherPresentations $app $path
  Start-Sleep -Milliseconds 200

  $opened = Try-OpenPath $app $path
  if ($opened) { return $opened }

  $simple = Copy-DeckForOpen $path
  if ($simple -and ((Normalize-Path $simple) -ne (Normalize-Path $path))) {
    $opened = Try-OpenPath $app $simple
    if ($opened) { return $opened }
  }

  try {
    Start-Process -FilePath $path | Out-Null
    for ($i = 0; $i -lt 20; $i++) {
      Start-Sleep -Milliseconds 250
      $opened = Find-Presentation $app $path
      if (-not $opened -and $simple) { $opened = Find-Presentation $app $simple }
      if ($opened) { return $opened }
      $fromPv = Try-ProtectedView $app $path
      if ($fromPv) { return $fromPv }
    }
  } catch {}

  throw [InvalidOperationException]::new("PowerPoint could not open the cached deck. Close the USCLC / other open presentation, then Follow loaded cue again.")
}

function Start-Show($pres) {
  if (-not $pres) { return $false }
  try {
    if ($pres.Application.SlideShowWindows.Count -gt 0) {
      $live = $null
      try { $live = $pres.Application.SlideShowWindows.Item(1).Presentation } catch {}
      if ($live -and ((Normalize-Path $live.FullName) -eq (Normalize-Path $pres.FullName))) {
        return $true
      }
    }
  } catch {}
  try {
    $settings = $pres.SlideShowSettings
    $settings.ShowType = 1
    $settings.LoopUntilStopped = 0
    $settings.Run() | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Exit-Shows($app) {
  try {
    while ($app.SlideShowWindows.Count -gt 0) {
      $app.SlideShowWindows.Item(1).View.Exit()
    }
  } catch {}
}

function Close-Presentation($app, $pres) {
  if (-not $pres) { return }
  try {
    if ($app.SlideShowWindows.Count -gt 0) {
      $showPres = $null
      try { $showPres = $app.SlideShowWindows.Item(1).Presentation } catch {}
      if ($showPres -and ((Normalize-Path $showPres.FullName) -eq (Normalize-Path $pres.FullName))) {
        try { $app.SlideShowWindows.Item(1).View.Exit() } catch {}
      }
    }
  } catch {}
  try { $pres.Close() } catch {}
}

try {

$needsLaunch = $Command -in @('open', 'swap')
$ppt = if ($needsLaunch) { Ensure-PptApp } else { Get-PptApp }

if (-not $ppt) {
  Write-Json @{ ok = $false; error = 'PowerPoint is not running. Open PowerPoint, then Follow loaded cue.' }
  exit 0
}

if ($Command -eq 'open' -or $Command -eq 'swap') {
  if (-not $FilePath -or -not (Test-Path -LiteralPath $FilePath)) {
    Write-Json @{ ok = $false; error = 'Cached deck file is missing. Click Sync cache, then Follow loaded cue.' }
    exit 0
  }
  Exit-Shows $ppt
  if ($ClosePath -and ((Normalize-Path $ClosePath) -ne (Normalize-Path $FilePath))) {
    $old = Find-Presentation $ppt $ClosePath
    if ($old) { Close-Presentation $ppt $old }
  }
  $pres = Open-Presentation $ppt $FilePath
  $started = Start-Show $pres
  Start-Sleep -Milliseconds 250
  $payload = Live-Payload $ppt $pres
  if (-not $started -and -not $payload.slideshowActive) {
    $payload.showWarning = 'Deck opened. Slideshow did not start — use Start slideshow on the Launcher page.'
  }
  Write-Json $payload
  exit 0
}

if ($Command -eq 'close') {
  $target = $null
  if ($FilePath) { $target = Find-Presentation $ppt $FilePath }
  if (-not $target) { try { $target = $ppt.ActivePresentation } catch {} }
  Close-Presentation $ppt $target
  Write-Json @{ ok = $true; closed = $true }
  exit 0
}

if ($Command -eq 'endShow') {
  Exit-Shows $ppt
  $pres = $null
  try { $pres = $ppt.ActivePresentation } catch {}
  Write-Json (Live-Payload $ppt $pres)
  exit 0
}

if ($Command -eq 'startShow') {
  $pres = $null
  if ($FilePath) { $pres = Find-Presentation $ppt $FilePath }
  if (-not $pres) { try { $pres = $ppt.ActivePresentation } catch {} }
  if (-not $pres) {
    Write-Json @{ ok = $false; error = 'No presentation open to start.' }
    exit 0
  }
  Start-Show $pres
  Write-Json (Live-Payload $ppt $pres)
  exit 0
}

if ($Command -eq 'next' -or $Command -eq 'prev' -or $Command -eq 'goto') {
  if ($ppt.SlideShowWindows.Count -lt 1) {
    Write-Json @{ ok = $false; error = 'Slideshow is not running. Use Start slideshow first.' }
    exit 0
  }
  $view = $ppt.SlideShowWindows.Item(1).View
  if ($Command -eq 'next') { $view.Next() }
  elseif ($Command -eq 'prev') { $view.Previous() }
  elseif ($SlideIndex -gt 0) { $view.GotoSlide($SlideIndex) }
  else {
    Write-Json @{ ok = $false; error = 'goto requires SlideIndex >= 1' }
    exit 0
  }
  $pres = $null
  try { $pres = $ppt.SlideShowWindows.Item(1).Presentation } catch {}
  if (-not $pres) { try { $pres = $ppt.ActivePresentation } catch {} }
  Write-Json (Live-Payload $ppt $pres)
  exit 0
}

$pres = $null
try { $pres = $ppt.ActivePresentation } catch {}
if (-not $pres) {
  Write-Json @{ ok = $false; error = 'No active presentation in PowerPoint.' }
  exit 0
}

if ($Command -eq 'status') {
  Write-Json @{
    ok = $true
    powerpointRunning = $true
    deckName = [string]$pres.Name
    slideCount = [int]$pres.Slides.Count
  }
  exit 0
}

if ($Command -eq 'live') {
  Write-Json (Live-Payload $ppt $pres)
  exit 0
}

if ($Command -eq 'snapshot') {
  if (-not $OutDir) {
    Write-Json @{ ok = $false; error = 'OutDir required' }
    exit 0
  }
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $slides = @()
  foreach ($s in $pres.Slides) {
    $id = [string][int]$s.SlideID
    $index = [int]$s.SlideIndex
    $jpg = Join-Path $OutDir ("$id.jpg")
    $s.Export($jpg, 'JPG', 480, 270)
    $slides += @{
      pptSlideId = $id
      slideIndex = $index
      title = Get-SlideTitle $s
      fileName = "$id.jpg"
      width = 480
      height = 270
    }
  }
  Write-Json @{
    ok = $true
    deckName = [string]$pres.Name
    slideCount = @($slides).Count
    slides = $slides
  }
  exit 0
}

Write-Json @{ ok = $false; error = "Unknown command $Command" }

} catch {
  Write-Json @{ ok = $false; error = (Friendly-ComError $_.Exception.Message) }
  exit 0
}
