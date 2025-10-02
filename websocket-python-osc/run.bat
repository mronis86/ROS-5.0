@echo off
echo Starting WebSocket OSC Control Panel...
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
python -c "import requests, websocket" >nul 2>&1
if errorlevel 1 (
    echo ERROR: Required dependencies not installed
    echo Please run install.bat first
    pause
    exit /b 1
)

echo Starting WebSocket OSC Control Panel...
echo.
echo Features:
echo - Real-time WebSocket connection to your API server
echo - OSC server for external control
echo - Authentication system
echo - Event management
echo - Neon database integration
echo.

REM Run the WebSocket OSC app
python websocket_osc_app.py

if errorlevel 1 (
    echo.
    echo Application exited with an error
    pause
)