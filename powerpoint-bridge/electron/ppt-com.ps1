param(
  [Parameter(Mandatory = $true)][string]$Command,
  [string]$OutDir = '',
  [string]$FilePath = '',
  [string]$ClosePath = '',
  [int]$SlideIndex = 0,
  [int]$Width = 0,
  [int]$Height = 0,
  # off | slideshow | app — which window to bring forward after open/swap/startShow
  # legacy: "presentation" is treated as slideshow
  [string]$FocusTarget = 'off',
  # when true: strip MotW + call Protected View → Enable Editing (security/notification bar)
  [string]$ForceEditMode = 'false'
)

function Want-ForceEdit {
  $v = ([string]$ForceEditMode).Trim().ToLowerInvariant()
  return ($v -eq 'true' -or $v -eq '1' -or $v -eq 'yes' -or $v -eq 'on')
}

function Normalize-FocusTarget([string]$raw) {
  $mode = ([string]$raw).Trim().ToLowerInvariant()
  if ($mode -eq 'presentation') { return 'slideshow' } # legacy label meant slide show
  if ($mode -eq 'slideshow' -or $mode -eq 'app' -or $mode -eq 'off') { return $mode }
  return 'off'
}

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

function Get-LivePresentation($app) {
  if (-not $app) { return $null }
  try {
    if ($app.SlideShowWindows.Count -gt 0) {
      $p = $app.SlideShowWindows.Item(1).Presentation
      if ($p) { return $p }
    }
  } catch {}
  try { return $app.ActivePresentation } catch {}
  try {
    if ($app.Presentations.Count -gt 0) { return $app.Presentations.Item(1) }
  } catch {}
  return $null
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
  # Strip Mark-of-the-Web so Office is less likely to open in Protected View.
  try { Unblock-File -LiteralPath $path -ErrorAction SilentlyContinue } catch {}
  try {
    $zone = "$path`:Zone.Identifier"
    if (Test-Path -LiteralPath $zone) {
      Remove-Item -LiteralPath $zone -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}

function Enable-ProtectedViewEdit($pv) {
  if (-not (Want-ForceEdit)) { return $null }
  if (-not $pv) { return $null }
  try { return $pv.Edit('') } catch {}
  try { return $pv.Edit() } catch {}
  return $null
}

function Try-ProtectedView($app, $path) {
  # If the deck is already in Protected View, force Enable Editing so slideshow/COM work.
  if (-not (Want-ForceEdit)) { return $null }
  try {
    $want = Normalize-Path $path
    $wantName = ''
    try { $wantName = [IO.Path]::GetFileName($path).ToLowerInvariant() } catch {}
    foreach ($pv in @($app.ProtectedViewWindows)) {
      $match = $false
      $source = ''
      try { $source = [string]$pv.SourcePath } catch {}
      try { if (-not $source) { $source = [string]$pv.Presentation.FullName } } catch {}
      if ($want -and $source -and ((Normalize-Path $source) -eq $want)) { $match = $true }
      if (-not $match -and $wantName -and $source) {
        try {
          if ([IO.Path]::GetFileName($source).ToLowerInvariant() -eq $wantName) { $match = $true }
        } catch {}
      }
      if (-not $match -and $wantName) {
        try {
          $cap = (([string]$pv.Caption) -replace ' \[Protected View\]$', '').ToLowerInvariant()
          if ($cap -eq $wantName) { $match = $true }
        } catch {}
      }
      if ($match) {
        $edited = Enable-ProtectedViewEdit $pv
        if ($edited) { return $edited }
      }
    }
    # Single PV window after our open attempt — treat as the target deck.
    try {
      if ([int]$app.ProtectedViewWindows.Count -eq 1) {
        $edited = Enable-ProtectedViewEdit $app.ProtectedViewWindows.Item(1)
        if ($edited) { return $edited }
      }
    } catch {}
  } catch {}
  return $null
}

function Try-OpenViaProtectedView($app, $path) {
  # Explicit PV open → Edit when Presentations.Open lands in / fails under Protected View.
  if (-not (Want-ForceEdit)) { return $null }
  try {
    $pv = $app.ProtectedViewWindows.Open($path)
    if (-not $pv) { return $null }
    Start-Sleep -Milliseconds 120
    return (Enable-ProtectedViewEdit $pv)
  } catch {}
  return $null
}

function Close-OtherPresentations($app, $keepPath) {
  Close-AllPresentations $app $keepPath
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
  try {
    $p = $app.Presentations.Open($path, $false, $false, $true)
    if ($p) { return $p }
  } catch {}
  # Open frequently lands in Protected View (MotW / internet) instead of Presentations.
  $fromPv = Try-ProtectedView $app $path
  if ($fromPv) { return $fromPv }
  try {
    $p = $app.Presentations.Open($path)
    if ($p) { return $p }
  } catch {}
  $fromPv = Try-ProtectedView $app $path
  if ($fromPv) { return $fromPv }
  return (Try-OpenViaProtectedView $app $path)
}

function Try-OpenHidden($app, $path) {
  $existing = Find-Presentation $app $path
  if ($existing) { return $existing }
  $fromPv = Try-ProtectedView $app $path
  if ($fromPv) { return $fromPv }
  try {
    $p = $app.Presentations.Open($path, $false, $false, $false)
    if ($p) { return $p }
  } catch {}
  $fromPv = Try-ProtectedView $app $path
  if ($fromPv) { return $fromPv }
  try {
    $p = $app.Presentations.Open($path, 0, 0, 0)
    if ($p) { return $p }
  } catch {}
  $fromPv = Try-ProtectedView $app $path
  if ($fromPv) { return $fromPv }
  return (Try-OpenViaProtectedView $app $path)
}

function Start-Show-OnTop($app, $pres) {
  if (-not $pres) { return $false }
  try {
    if ($app -and $app.SlideShowWindows.Count -gt 0) {
      $live = $null
      try { $live = $app.SlideShowWindows.Item(1).Presentation } catch {}
      if ($live -and ((Normalize-Path $live.FullName) -eq (Normalize-Path $pres.FullName))) {
        Focus-Show $app $pres $FocusTarget
        return $true
      }
    }
  } catch {}
  try {
    $settings = $pres.SlideShowSettings
    $settings.ShowType = 1
    $settings.LoopUntilStopped = 0
    try { $settings.RangeType = 1 } catch {}
    $settings.Run() | Out-Null
    Start-Sleep -Milliseconds 80
    Focus-Show $app $pres $FocusTarget
    try { return ([int]$app.SlideShowWindows.Count -gt 0) } catch { return $true }
  } catch {
    return $false
  }
}

function Close-Others-KeepShow($app, $keepPath) {
  $keep = Normalize-Path $keepPath
  $list = @()
  try { $list = @($app.Presentations) } catch { return }
  foreach ($p in $list) {
    try {
      if ($keep -and ((Normalize-Path $p.FullName) -eq $keep)) { continue }
      try { $p.Saved = $true } catch {}
      try { $p.Close() } catch {}
    } catch {}
  }
}

function Swap-To-Presentation($app, $path) {
  Unblock-Deck $path
  $opened = Try-OpenHidden $app $path
  if (-not $opened) { $opened = Try-OpenPath $app $path }
  if (-not $opened) { return Open-Presentation $app $path }

  $started = Start-Show-OnTop $app $opened
  if (-not $started) { return Open-Presentation $app $path }

  Close-Others-KeepShow $app $path
  try {
    if ([int]$app.SlideShowWindows.Count -lt 1) { Start-Show-OnTop $app $opened | Out-Null }
  } catch {}
  Focus-Show $app $opened $FocusTarget
  return $opened
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
  $app = $null
  try { $app = $pres.Application } catch {}
  try {
    if ($app -and $app.SlideShowWindows.Count -gt 0) {
      $live = $null
      try { $live = $app.SlideShowWindows.Item(1).Presentation } catch {}
      if ($live -and ((Normalize-Path $live.FullName) -eq (Normalize-Path $pres.FullName))) {
        Focus-Show $app $pres $FocusTarget
        return $true
      }
      Exit-Shows $app
      Start-Sleep -Milliseconds 250
    }
  } catch {}
  $ran = $false
  try {
    $settings = $pres.SlideShowSettings
    $settings.ShowType = 1
    $settings.LoopUntilStopped = 0
    try { $settings.RangeType = 1 } catch {}
    $settings.Run() | Out-Null
    $ran = $true
  } catch {
    $ran = $false
  }
  if (-not $ran) {
    try {
      Add-Type -AssemblyName System.Windows.Forms
      Focus-Show $app $pres 'app'
      Start-Sleep -Milliseconds 200
      [System.Windows.Forms.SendKeys]::SendWait('{F5}')
      Start-Sleep -Milliseconds 450
    } catch {}
  }
  Start-Sleep -Milliseconds 250
  Focus-Show $app $pres $FocusTarget
  try { return ([int]$app.SlideShowWindows.Count -gt 0) } catch { return $ran }
}

function Exit-Shows($app) {
  if (-not $app) { return }
  for ($pass = 0; $pass -lt 3; $pass++) {
    try {
      $count = [int]$app.SlideShowWindows.Count
      for ($i = $count; $i -ge 1; $i--) {
        try { $app.SlideShowWindows.Item($i).View.Exit() } catch {}
      }
    } catch {}
    Start-Sleep -Milliseconds 250
    try { if ([int]$app.SlideShowWindows.Count -lt 1) { break } } catch { break }
  }
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
  try { $pres.Saved = $true } catch {}
  try { $pres.Close() } catch {}
}

function Close-AllPresentations($app, $keepPath) {
  Exit-Shows $app
  Start-Sleep -Milliseconds 350
  $keep = Normalize-Path $keepPath
  $list = @()
  try { $list = @($app.Presentations) } catch { $list = @() }
  foreach ($p in $list) {
    try {
      if ($keep -and ((Normalize-Path $p.FullName) -eq $keep)) { continue }
      Close-Presentation $app $p
    } catch {}
  }
  Start-Sleep -Milliseconds 250
}

# Win32 helpers — COM Activate alone often loses to Windows focus-stealing rules.
try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RosPptFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@ -ErrorAction SilentlyContinue
} catch {}

function Focus-Hwnd([IntPtr]$hwnd) {
  if (-not $hwnd -or $hwnd -eq [IntPtr]::Zero) { return }
  try {
    [void][RosPptFocus]::ShowWindow($hwnd, 9) # SW_RESTORE
    $fg = [RosPptFocus]::GetForegroundWindow()
    $fgPid = [uint32]0
    $fgTid = [RosPptFocus]::GetWindowThreadProcessId($fg, [ref]$fgPid)
    $curTid = [RosPptFocus]::GetCurrentThreadId()
    if ($fgTid -ne $curTid) { [void][RosPptFocus]::AttachThreadInput($curTid, $fgTid, $true) }
    [void][RosPptFocus]::BringWindowToTop($hwnd)
    [void][RosPptFocus]::SetForegroundWindow($hwnd)
    if ($fgTid -ne $curTid) { [void][RosPptFocus]::AttachThreadInput($curTid, $fgTid, $false) }
  } catch {}
}

function Get-SlideShowHwnd($app) {
  # Prefer the largest SlideShow window (audience display over notes / presenter chrome).
  $best = [IntPtr]::Zero
  $bestArea = -1
  try {
    $n = [int]$app.SlideShowWindows.Count
    for ($i = 1; $i -le $n; $i++) {
      $ssw = $null
      try { $ssw = $app.SlideShowWindows.Item($i) } catch { continue }
      if (-not $ssw) { continue }
      try { $ssw.Activate() } catch {}
      $h = [IntPtr]::Zero
      try { $h = [IntPtr]$ssw.HWND } catch { $h = [IntPtr]::Zero }
      if ($h -eq [IntPtr]::Zero) { continue }
      $area = 0
      try { $area = [math]::Abs([int]$ssw.Width) * [math]::Abs([int]$ssw.Height) } catch { $area = $i }
      if ($area -ge $bestArea) {
        $bestArea = $area
        $best = $h
      }
    }
  } catch {}
  return $best
}

function Focus-Show($app, $pres, $target) {
  $mode = Normalize-FocusTarget $target
  if ($mode -ne 'slideshow' -and $mode -ne 'app') { return }

  try { $app.Visible = $true } catch {
    try { $app.Visible = -1 } catch {}
  }

  $hwnd = [IntPtr]::Zero
  if ($mode -eq 'slideshow') {
    # Slide show only — never fall back to Normal/edit "presentation" window.
    for ($attempt = 0; $attempt -lt 8; $attempt++) {
      $hwnd = Get-SlideShowHwnd $app
      if ($hwnd -ne [IntPtr]::Zero) { break }
      Start-Sleep -Milliseconds 80
    }
    if ($hwnd -eq [IntPtr]::Zero) { return }
  } else {
    # PowerPoint app / document window (edit UI), not the slide show.
    try { $app.Activate() } catch {}
    try { $app.WindowState = 1 } catch {} # ppWindowNormal
    try {
      if ($pres -and $pres.Windows.Count -gt 0) { $pres.Windows.Item(1).Activate() }
    } catch {}
    try { $hwnd = [IntPtr]$app.HWND } catch { $hwnd = [IntPtr]::Zero }
  }

  if ($hwnd -ne [IntPtr]::Zero) { Focus-Hwnd $hwnd }
}

try {

if ($Command -eq 'watch') {
  $dir = if ($OutDir) { $OutDir } else { $env:TEMP }
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $outFile = Join-Path $dir 'ros-ppt-live.json'
  $tmpFile = "$outFile.tmp"
  while ($true) {
    $payload = @{ ok = $false; error = 'PowerPoint is not running.'; fullName = ''; slideshowActive = $false; slideIndex = $null; slideCount = 0; deckName = '' }
    try {
      $app = Get-PptApp
      if ($app) {
        $pres = Get-LivePresentation $app
        if ($pres) { $payload = Live-Payload $app $pres }
        else { $payload = @{ ok = $false; error = 'No presentation is open in PowerPoint.'; fullName = ''; slideshowActive = $false; slideIndex = $null; slideCount = 0; deckName = '' } }
      }
    } catch {
      $payload = @{ ok = $false; error = (Friendly-ComError $_.Exception.Message); fullName = ''; slideshowActive = $false }
    }
    try {
      [IO.File]::WriteAllText($tmpFile, ($payload | ConvertTo-Json -Compress -Depth 8))
      [IO.File]::Copy($tmpFile, $outFile, $true)
    } catch {}
    Start-Sleep -Milliseconds 180
  }
}

if ($Command -eq 'endShow' -or $Command -eq 'quit') {
  $app = Get-PptApp
  if ($app) {
    try { Exit-Shows $app } catch {}
    try { Close-AllPresentations $app $null } catch {}
    try { $app.Quit() } catch {}
    Start-Sleep -Milliseconds 400
  }
  try {
    Get-Process -Name POWERPNT,POWERPNT.EXE -ErrorAction SilentlyContinue | Stop-Process -Force
  } catch {}
  Write-Json @{ ok = $true; closed = $true; quit = $true; slideshowActive = $false; deckName = ''; slideCount = 0; slideIndex = $null }
  exit 0
}

$needsLaunch = $Command -in @('open', 'swap')
$ppt = if ($needsLaunch) { Ensure-PptApp } else { Get-PptApp }

if (-not $ppt) {
  Write-Json @{ ok = $false; error = 'PowerPoint is not running. Open PowerPoint, then Follow loaded cue.' }
  exit 0
}

if ($Command -eq 'open' -or $Command -eq 'swap') {
  if (-not $FilePath -or -not (Test-Path -LiteralPath $FilePath)) {
    Write-Json @{ ok = $false; error = 'Cached deck file is missing. Click Sync decks, then Follow ROS cues.' }
    exit 0
  }
  $pres = Find-Presentation $ppt $FilePath
  $otherOpen = $false
  try { $otherOpen = -not $pres -and [int]$ppt.Presentations.Count -gt 0 } catch {}
  if ($pres) {
    $started = Start-Show $pres
  } elseif ($otherOpen) {
    $pres = Swap-To-Presentation $ppt $FilePath
    $started = $false
    try { $started = [int]$ppt.SlideShowWindows.Count -gt 0 } catch {}
    if (-not $started) { $started = Start-Show $pres }
  } else {
    $pres = Open-Presentation $ppt $FilePath
    $started = Start-Show $pres
  }
  if (-not $started) {
    try {
      $pptPath = Join-Path $env:ProgramFiles 'Microsoft Office\root\Office16\POWERPNT.EXE'
      if (-not (Test-Path -LiteralPath $pptPath)) {
        $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
        if ($pf86) { $pptPath = Join-Path $pf86 'Microsoft Office\root\Office16\POWERPNT.EXE' }
      }
      if (Test-Path -LiteralPath $pptPath) {
        Start-Process -FilePath $pptPath -ArgumentList @('/s', $FilePath) | Out-Null
        Start-Sleep -Milliseconds 800
        $started = $true
      }
    } catch {}
  }
  Start-Sleep -Milliseconds 250
  $focusMode = Normalize-FocusTarget $FocusTarget
  if ($focusMode -ne 'off') { Focus-Show $ppt $pres $focusMode }
  $payload = Live-Payload $ppt $pres
  $payload.fullName = $FilePath
  if (-not $started -and -not $payload.slideshowActive) {
    $payload.showWarning = 'Deck opened. Slideshow did not start — use Start slideshow on the Launcher page.'
  }
  Write-Json $payload
  exit 0
}

if ($Command -eq 'close') {
  Close-AllPresentations $ppt $null
  Write-Json @{ ok = $true; closed = $true }
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
  Start-Sleep -Milliseconds 200
  $focusMode = Normalize-FocusTarget $FocusTarget
  if ($focusMode -ne 'off') { Focus-Show $ppt $pres $focusMode }
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

$pres = Get-LivePresentation $ppt
if (-not $pres) {
  Write-Json @{ ok = $false; error = 'No presentation is open in PowerPoint.'; fullName = '' }
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
  $exportW = if ($Width -gt 0) { $Width } else { 480 }
  $exportH = if ($Height -gt 0) { $Height } else { 270 }
  $slides = @()
  foreach ($s in $pres.Slides) {
    $id = [string][int]$s.SlideID
    $index = [int]$s.SlideIndex
    $jpg = Join-Path $OutDir ("$id.jpg")
    try {
      $s.Export($jpg, 'JPG', $exportW, $exportH)
    } catch {
      continue
    }
    if (-not (Test-Path $jpg)) { continue }
    $slides += @{
      pptSlideId = $id
      slideIndex = $index
      title = Get-SlideTitle $s
      fileName = "$id.jpg"
      width = $exportW
      height = $exportH
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
