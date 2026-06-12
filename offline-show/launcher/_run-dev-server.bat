@echo off
pushd "%~dp0.."
if errorlevel 1 (
  echo Could not open offline-show folder.
  pause
  exit /b 1
)
call "%~dp0bootstrap.bat" --rebuild-ui
if errorlevel 1 (
  popd
  pause
  exit /b 1
)
echo Starting offline server on port 3004...
node server\server.js
popd
pause
