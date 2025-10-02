@echo off
echo Testing Minimal Graphics Generator...
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.8+ from https://python.org
    pause
    exit /b 1
)

REM Check if requirements are installed
python -c "import requests, socketio" >nul 2>&1
if errorlevel 1 (
    echo ERROR: Required dependencies not installed
    echo Please run install_optimized_graphics.bat first
    pause
    exit /b 1
)

echo Starting minimal application...
echo.
echo Instructions:
echo 1. Click the "Connect" button
echo 2. Watch the status change to "Connected via Socket.IO"
echo 3. The log will show connection progress
echo 4. Close the window when done
echo.

REM Run the minimal application
python minimal_app.py

pause
