@echo off
echo.
echo ========================================
echo   ROS OSC Control - Starting App Only
echo ========================================
echo.
echo NOTE: Make sure api-server.js is already running!
echo.

cd /d "%~dp0"

if not exist "node_modules" (
    echo ❌ Dependencies not installed!
    echo Please run: npm install
    pause
    exit /b 1
)

echo Starting OSC Control app...
npm start

pause

