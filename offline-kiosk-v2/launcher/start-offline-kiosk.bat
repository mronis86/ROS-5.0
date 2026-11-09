@echo off
setlocal
cd /d "%~dp0.."

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo Installing Offline Kiosk dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting ROS Offline Kiosk...
call npm start
endlocal
