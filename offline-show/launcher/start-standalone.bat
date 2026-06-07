@echo off
setlocal EnableDelayedExpansion
set "OFFLINE=%~dp0.."

echo ========================================
echo   ROS Offline Show
echo ========================================
echo.

cd /d "%OFFLINE%"
if not exist "node_modules\better-sqlite3" (
  echo Installing server dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist "ui\dist\index.html" (
  echo UI not built. Re-download offline-show.zip or run from full ROS repo.
  pause
  exit /b 1
)

echo Stopping anything on port 3004...
call npx --yes kill-port 3004 2>nul

echo Starting show server on port 3004...
start "ROS Offline Show" cmd /k "cd /d \"%OFFLINE%\" && node server\server.js"

echo Waiting for server...
timeout /t 4 /nobreak >nul

echo Opening browser...
start "" "http://127.0.0.1:3004/"

echo.
echo This PC: http://127.0.0.1:3004/
echo Other devices on Wi-Fi: http://YOUR-LAN-IP:3004/
echo If LAN fails, run allow-lan-firewall.bat as Administrator.
echo.
pause
