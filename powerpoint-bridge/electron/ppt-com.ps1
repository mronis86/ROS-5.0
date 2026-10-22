param(
  [Parameter(Mandatory = $true)][string]$Command,
  [string]$OutDir = ''
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

$ppt = Get-PptApp
if (-not $ppt) {
  Write-Json @{ ok = $false; error = 'PowerPoint is not running. Open the deck first.' }
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
  $showActive = $false
  $slideId = $null
  $index = $null
  $title = ''
  try {
    if ($ppt.SlideShowWindows.Count -gt 0) {
      $showActive = $true
      $slide = $ppt.SlideShowWindows.Item(1).View.Slide
      $slideId = [string][int]$slide.SlideID
      $index = [int]$slide.SlideIndex
      $title = Get-SlideTitle $slide
    }
  } catch {}
  Write-Json @{
    ok = $true
    slideshowActive = $showActive
    pptSlideId = $slideId
    slideIndex = $index
    title = $title
    deckName = [string]$pres.Name
    slideCount = [int]$pres.Slides.Count
  }
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
