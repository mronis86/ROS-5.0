@echo off
setlocal
rem Always resolve offline-show root from this script's location (works after unzip / move).
pushd "%~dp0.."
if errorlevel 1 (
  echo Could not open offline-show folder.
  echo Launcher path: %~dp0
  pause
  exit /b 1
)
echo Working folder: %CD%
echo Starting server on port 3004...
node server\server.js
echo.
echo Server stopped.
pause
popd
endlocal
