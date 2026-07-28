@echo off
setlocal

echo ========================================
echo   ROS vMix DataSource Bridge
echo ========================================
echo.

cd /d "%~dp0.."
if errorlevel 1 (
  echo Could not open vmix-datasource-bridge folder.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed or not on PATH.
  echo Install Node 22+ from https://nodejs.org then try again.
  pause
  exit /b 1
)

if not exist "node_modules\electron\package.json" (
  echo Installing dependencies - first run...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting ROS vMix DataSource Bridge...
echo.
call npm start
if errorlevel 1 (
  echo.
  echo App exited with an error.
  pause
  exit /b 1
)

endlocal
