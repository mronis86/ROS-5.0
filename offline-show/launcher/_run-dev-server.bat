@echo off
cd /d "%~dp0.."
call "%~dp0bootstrap.bat" --rebuild-ui
if errorlevel 1 pause & exit /b 1
echo Starting offline server on port 3004...
node server\server.js
pause
