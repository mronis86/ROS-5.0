@echo off
echo ========================================
echo   ROS Local Server Starter
echo ========================================
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    echo This will take a few minutes the first time.
    echo.
    call npm install
    echo.
    echo Dependencies installed!
    echo.
)

echo Starting Local Server...
echo.
echo ========================================
echo   Server Information:
echo ========================================
echo   React App: http://localhost:3002
echo   API Server: http://localhost:3002/api
echo.
echo   Press Ctrl+C to stop the server
echo ========================================
echo.

node server.js

pause

