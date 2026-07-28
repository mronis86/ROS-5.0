# Creates Desktop + launcher-folder shortcuts for ROS vMix DataSource Bridge with a custom icon.
# Run: create-desktop-shortcut.bat  (or this script directly)

$ErrorActionPreference = 'Stop'

$launcherDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot = Split-Path -Parent $launcherDir

$targetBat = Join-Path $appRoot 'START.bat'
if (-not (Test-Path $targetBat)) {
  $targetBat = Join-Path $launcherDir 'start-ros-vmix-datasource.bat'
}

if (-not (Test-Path $targetBat)) {
  Write-Error "Could not find START.bat or start-ros-vmix-datasource.bat"
}

$iconPath = Join-Path $launcherDir 'ros-vmix-datasource.ico'
$buildIco = Join-Path $appRoot 'build\icon.ico'
if (-not (Test-Path $iconPath) -and (Test-Path $buildIco)) {
  Copy-Item $buildIco $iconPath -Force
}

if (-not (Test-Path $iconPath)) {
  Write-Error "Missing icon: $iconPath (expected launcher\ros-vmix-datasource.ico)"
}

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
  $sc.Description = 'ROS vMix DataSource Bridge - follow ROS cues into vMix Data Sources'
  $sc.IconLocation = "$IcoPath,0"
  $sc.Save()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($shell) | Out-Null
}

$desktop = [Environment]::GetFolderPath('Desktop')
$desktopLnk = Join-Path $desktop 'ROS vMix DataSource Bridge.lnk'
$localLnk = Join-Path $launcherDir 'ROS vMix DataSource Bridge.lnk'

New-RosShortcut -ShortcutPath $desktopLnk -BatPath $targetBat -IcoPath $iconPath
New-RosShortcut -ShortcutPath $localLnk -BatPath $targetBat -IcoPath $iconPath

Write-Host ""
Write-Host "Shortcuts created:"
Write-Host "  Desktop:  $desktopLnk"
Write-Host "  Launcher: $localLnk"
Write-Host ""
Write-Host "Double-click ROS vMix DataSource Bridge - it uses the custom icon."
Write-Host "You can pin the Desktop shortcut to the taskbar / Start."
