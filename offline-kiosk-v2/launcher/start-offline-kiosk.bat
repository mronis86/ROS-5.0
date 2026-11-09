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

if exist "engines\offline-show\launcher\bootstrap.bat" (
  pushd "engines\offline-show"
  call "launcher\bootstrap.bat" --skip-ui-build
  if errorlevel 1 call "launcher\bootstrap.bat"
  if errorlevel 1 (
    echo Offline Show bootstrap failed.
    popd
    pause
    exit /b 1
  )
  popd
)

echo Starting ROS Offline Kiosk...
call npm start
endlocal
