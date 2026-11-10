@echo off
setlocal EnableExtensions
title ROS Offline Kiosk — stop / unlock folder

REM Force-stop engines that keep the install folder locked after the window closes:
REM   - Offline Kiosk (Electron)
REM   - Offline Show (node server.js on :3004)
REM   - WebLinked (sinor-weblinked / weblinked)

echo.
echo Stopping Offline Kiosk, Offline Show, and WebLinked...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "Get-CimInstance Win32_Process | Where-Object {" ^
  "  ($_.Name -match '^(electron|ROS Offline Kiosk|ROS Offline Kiosk.exe)$') -or" ^
  "  ($_.CommandLine -and (" ^
  "    $_.CommandLine -match 'offline-kiosk-v2' -or" ^
  "    $_.CommandLine -match 'ROS-Offline-Kiosk' -or" ^
  "    $_.CommandLine -match 'ros-offline-kiosk'" ^
  "  ))" ^
  "} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };" ^
  "Get-CimInstance Win32_Process | Where-Object {" ^
  "  $_.Name -match '^(node|node\\.exe)$' -and $_.CommandLine -and (" ^
  "    $_.CommandLine -match 'offline-show[\\\\/]+server[\\\\/]+server\\.js' -or" ^
  "    ($_.CommandLine -match 'server[\\\\/]+server\\.js' -and $_.CommandLine -match 'offline-show')" ^
  "  )" ^
  "} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };" ^
  "foreach ($img in @('sinor-weblinked.exe','weblinked.exe')) {" ^
  "  Get-Process -Name ($img -replace '\\.exe$','') -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue;" ^
  "  & taskkill.exe /F /IM $img /T 2>$null | Out-Null" ^
  "};" ^
  "$conns = Get-NetTCPConnection -LocalPort 3004 -State Listen -ErrorAction SilentlyContinue;" ^
  "foreach ($c in @($conns)) { if ($c.OwningProcess) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } };" ^
  "Write-Host 'Done. Folder should unlock in a moment.'"

echo.
echo If Explorer still says the folder is in use, wait 2 seconds and try again.
echo.
pause
endlocal
