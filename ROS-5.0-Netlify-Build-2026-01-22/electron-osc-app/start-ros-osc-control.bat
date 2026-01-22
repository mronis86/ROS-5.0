@echo off
echo.
echo ======================================
echo   ROS OSC Control - Starting...
echo ======================================
echo.

cd /d "%~dp0"

echo Checking for node_modules...
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

echo Starting ROS OSC Control...
echo.
echo OSC Server will listen on port 57121
echo.
echo Press Ctrl+C to stop
echo.

call npm start

pause

