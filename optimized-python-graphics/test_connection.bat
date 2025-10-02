@echo off
echo Testing Optimized Graphics Generator Connection...
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

echo Running connection test...
echo.

REM Run the connection test
python test_connection.py

pause
