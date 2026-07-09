@echo off
setlocal

echo ========================================
echo   ROS LED Spout Bridge
echo ========================================
echo.

cd /d "%~dp0.."
if errorlevel 1 (
  echo Could not open spout-bridge folder.
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

if not exist "vendor\SpoutLibrary.dll" (
  echo.
  echo WARNING: vendor\SpoutLibrary.dll is missing.
  echo Copy it from Spout2 SDK binaries before publishing to Spout.
  echo See vendor\README.md
  echo.
)

echo Starting ROS LED Spout...
call npm start
if errorlevel 1 (
  echo.
  echo ROS LED Spout exited with an error.
  pause
  exit /b 1
)

endlocal
