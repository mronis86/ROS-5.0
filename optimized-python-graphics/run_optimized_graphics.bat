@echo off
echo Starting Optimized Live Graphics Generator with Auto-Update...
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

echo Starting application with auto-update feature...
echo.
echo Features:
echo - Real-time Socket.IO connection
echo - Auto-update files when data changes
echo - Egress-efficient (no polling)
echo - VMIX integration ready
echo.

REM Run the optimized graphics generator from current directory
python optimized_live_graphics_generator.py

if errorlevel 1 (
    echo.
    echo Application exited with an error
    pause
)
