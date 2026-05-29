@echo off
setlocal EnableDelayedExpansion
set "OFFLINE=%~dp0.."
set "REPO=%~dp0..\.."

echo ========================================
echo   ROS Offline Show - Phase 1
echo ========================================
echo.

cd /d "%OFFLINE%"
if not exist "node_modules\better-sqlite3" (
  echo Installing offline-show server dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

cd /d "%REPO%"
if not exist "node_modules\vite" (
  echo Run npm install from repo root first.
  pause
  exit /b 1
)

echo Stopping anything on port 3004...
call npx --yes kill-port 3004 2>nul

echo Starting offline server + UI in a new window...
start "ROS Offline Show" "%~dp0_run-dev-server.bat"

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
  echo *** IMPORTANT: Windows Firewall is blocking other devices on port 3004 ***
  echo Right-click and Run as administrator:
  echo   offline-show\launcher\allow-lan-firewall.bat
  echo Without this, iPad/other PCs see Chrome chrome-error and cannot connect.
  echo.
)

echo Server is up. Opening browser...
for /f "delims=" %%I in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1 -ExpandProperty IPAddress)"') do set "LAN_IP=%%I"
if defined LAN_IP (
  echo.
  echo LAN devices ^(iPad, etc.^): http://!LAN_IP!:3004/
  echo If that fails, run launcher\allow-lan-firewall.bat as Administrator
  echo.
)
start "" "http://127.0.0.1:3004/"

echo.
echo UI is pre-built with Tailwind so it matches port 3003. Re-run launcher after UI code changes.
echo Main app: port 3003 ^| Offline show: port 3004
echo.
pause
