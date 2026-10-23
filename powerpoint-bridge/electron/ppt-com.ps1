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
  $app.Visible = 1
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

function Start-Show($pres) {
  $settings = $pres.SlideShowSettings
  $settings.ShowType = 1
  $settings.LoopUntilStopped = 0
  $settings.Run() | Out-Null
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

$needsLaunch = $Command -in @('open', 'swap')
$ppt = if ($needsLaunch) { Ensure-PptApp } else { Get-PptApp }

if (-not $ppt) {
  Write-Json @{ ok = $false; error = 'PowerPoint is not running. Open the deck first.' }
  exit 0
}

if ($Command -eq 'open' -or $Command -eq 'swap') {
  if (-not $FilePath -or -not (Test-Path -LiteralPath $FilePath)) {
    Write-Json @{ ok = $false; error = 'FilePath missing or not found' }
    exit 0
  }
  $pres = Find-Presentation $ppt $FilePath
  if (-not $pres) {
    $pres = $ppt.Presentations.Open($FilePath, $false, $false, $true)
  }
  Start-Show $pres
  Start-Sleep -Milliseconds 250
  if ($ClosePath -and ((Normalize-Path $ClosePath) -ne (Normalize-Path $FilePath))) {
    $old = Find-Presentation $ppt $ClosePath
    if ($old) { Close-Presentation $ppt $old }
  }
  Write-Json (Live-Payload $ppt $pres)
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
    Write-Json @{ ok = $false; error = 'Slideshow is not running.' }
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
