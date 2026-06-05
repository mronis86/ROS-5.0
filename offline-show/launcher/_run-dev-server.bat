@echo off
cd /d "%~dp0.."
set REPO=%~dp0..\..
echo Building offline UI (matches main app styling)...
node scripts\build-ui.js
if errorlevel 1 (
  echo UI build failed.
  pause
  exit /b 1
)
echo Starting offline server on port 3004...
node server\server.js
pause
