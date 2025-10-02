@echo off
echo Testing Optimized Graphics Generator...
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

echo Starting application test...
echo.
echo Instructions:
echo 1. Enter an Event ID (or use 'test')
echo 2. Click the Connect button
echo 3. Watch the status change to show connection
echo 4. Close the window when done
echo.

REM Run the application test
python run_app_test.py

pause
