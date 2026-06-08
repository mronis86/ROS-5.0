@echo off
setlocal EnableDelayedExpansion
set "OFFLINE=%~dp0.."

echo ========================================
echo   ROS Offline Show (from full repo)
echo ========================================
echo.

cd /d "%OFFLINE%"
call "%~dp0bootstrap.bat" --rebuild-ui
if errorlevel 1 exit /b 1

echo Stopping anything on port 3004...
call npx --yes kill-port 3004 2>nul

echo Starting offline server on port 3004...
start "ROS Offline Show" cmd /k "cd /d \"%OFFLINE%\" && node server\server.js"

echo Waiting for server (up to 90s — first start can be slow)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wait-for-server.ps1"
if errorlevel 1 (
  echo.
  echo Server did not start. Check the "ROS Offline Show" window for errors.
  pause
  exit /b 1
)

echo.
echo Checking LAN readiness...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-lan-ready.ps1"

netsh advfirewall firewall show rule name="ROS Offline Show 3004" >nul 2>&1
if errorlevel 1 (
  echo.
  echo *** IMPORTANT: Windows Firewall may block other devices on port 3004 ***
  echo Right-click and Run as administrator:
  echo   offline-show\launcher\allow-lan-firewall.bat
  echo.
)

echo Server is up. Opening browser...
for /f "delims=" %%I in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1 -ExpandProperty IPAddress)"') do set "LAN_IP=%%I"
if defined LAN_IP (
  echo LAN devices ^(iPad, etc.^): http://!LAN_IP!:3004/
  echo.
)
start "" "http://127.0.0.1:3004/"

echo.
echo Installs its own dependencies under offline-show\ ^(no repo root npm install required^).
echo Main app: port 3003 ^| Offline show: port 3004
echo.
pause
