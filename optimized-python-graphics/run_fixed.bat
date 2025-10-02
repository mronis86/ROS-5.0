@echo off
echo Running Fixed Optimized Graphics Generator...
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

echo Starting fixed application...
echo.
echo Instructions:
echo 1. Enter an Event ID (or use 'test')
echo 2. Select an output folder
echo 3. Click "Connect" - status should change to "Connected via Socket.IO"
echo 4. Click "Refresh Data" to load schedule data
echo 5. Click "Generate Files" to create XML/CSV files
echo 6. Close the window when done
echo.

REM Run the fixed application
python fixed_graphics_generator.py

pause
