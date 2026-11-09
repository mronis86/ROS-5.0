# Creates Desktop + launcher-folder shortcuts for ROS Offline Show with a custom icon.
# Run: create-desktop-shortcut.bat  (or this script directly)

$ErrorActionPreference = 'Stop'

$launcherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$offlineRoot = Split-Path -Parent $launcherDir
$repoRoot = Split-Path -Parent $offlineRoot

$targetBat = Join-Path $launcherDir 'start-offline-show.bat'
if (-not (Test-Path $targetBat)) {
  # Standalone zip layout may only ship start-standalone.bat
  $standalone = Join-Path $launcherDir 'start-standalone.bat'
  if (Test-Path $standalone) { $targetBat = $standalone }
}

if (-not (Test-Path $targetBat)) {
  Write-Error "Could not find start-offline-show.bat or start-standalone.bat in $launcherDir"
}

$iconPath = Join-Path $launcherDir 'ros-offline-show.ico'
$pngCandidates = @(
  (Join-Path $offlineRoot 'ui\public\logos\sinor-track.png'),
  (Join-Path $offlineRoot 'ui\dist\logos\sinor-track.png'),
  (Join-Path $repoRoot 'public\logos\sinor-track.png')
)

function New-IcoFromPng {
  param([string]$PngPath, [string]$IcoPath)

  Add-Type -AssemblyName System.Drawing

  $src = [System.Drawing.Image]::FromFile($PngPath)
  try {
    $sizes = @(256, 48, 32, 16)
    $streams = New-Object System.Collections.Generic.List[System.IO.MemoryStream]

    foreach ($size in $sizes) {
      $bmp = New-Object System.Drawing.Bitmap $size, $size
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.DrawImage($src, 0, 0, $size, $size)

        $ms = New-Object System.IO.MemoryStream
        # PNG-compressed icon frames (Vista+)
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $streams.Add($ms) | Out-Null
      } finally {
        $g.Dispose()
        $bmp.Dispose()
      }
    }

    $fs = [System.IO.File]::Open($IcoPath, [System.IO.FileMode]::Create)
    try {
      $bw = New-Object System.IO.BinaryWriter $fs
      $count = $streams.Count
      # ICONDIR
      $bw.Write([uint16]0)
      $bw.Write([uint16]1)
      $bw.Write([uint16]$count)

      $offset = 6 + (16 * $count)
      for ($i = 0; $i -lt $count; $i++) {
        $data = $streams[$i].ToArray()
        $dim = $sizes[$i]
        $bw.Write([byte]($(if ($dim -ge 256) { 0 } else { $dim })))
        $bw.Write([byte]($(if ($dim -ge 256) { 0 } else { $dim })))
        $bw.Write([byte]0)
        $bw.Write([byte]0)
        $bw.Write([uint16]1)
        $bw.Write([uint16]32)
        $bw.Write([uint32]$data.Length)
        $bw.Write([uint32]$offset)
        $offset += $data.Length
      }
      foreach ($ms in $streams) {
        $bw.Write($ms.ToArray())
      }
      $bw.Flush()
    } finally {
      $fs.Dispose()
      foreach ($ms in $streams) { $ms.Dispose() }
    }
  } finally {
    $src.Dispose()
  }
}

$png = $pngCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $png) {
  Write-Error "No logo PNG found. Expected sinor-track.png under offline-show/ui/public/logos/"
}

Write-Host "Building icon from: $png"
New-IcoFromPng -PngPath $png -IcoPath $iconPath
Write-Host "Icon written: $iconPath"

function New-RosShortcut {
  param(
    [string]$ShortcutPath,
    [string]$BatPath,
    [string]$IcoPath
  )
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($ShortcutPath)
  $sc.TargetPath = $BatPath
  $sc.WorkingDirectory = Split-Path -Parent $BatPath
  $sc.WindowStyle = 1
  $sc.Description = 'ROS Offline Show - local LAN show server (:3004)'
  $sc.IconLocation = "$IcoPath,0"
  $sc.Save()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($shell) | Out-Null
}

$desktop = [Environment]::GetFolderPath('Desktop')
$desktopLnk = Join-Path $desktop 'ROS Offline Show.lnk'
$localLnk = Join-Path $launcherDir 'ROS Offline Show.lnk'

New-RosShortcut -ShortcutPath $desktopLnk -BatPath $targetBat -IcoPath $iconPath
New-RosShortcut -ShortcutPath $localLnk -BatPath $targetBat -IcoPath $iconPath

Write-Host ""
Write-Host "Shortcuts created:"
Write-Host "  Desktop:  $desktopLnk"
Write-Host "  Launcher: $localLnk"
Write-Host ""
Write-Host "Double-click ROS Offline Show - it uses the custom icon."
Write-Host "You can pin the Desktop shortcut to the taskbar / Start."
