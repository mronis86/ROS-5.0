@echo off
echo Starting Python OSC GUI...
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python is not installed or not in PATH
    echo Please install Python from https://python.org
    pause
    exit /b 1
)

REM Check if requirements are installed
echo Checking Python dependencies...
python -c "import supabase" >nul 2>&1
if errorlevel 1 (
    echo Installing Python dependencies...
    pip install -r python-osc-requirements.txt
    if errorlevel 1 (
        echo Error: Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Start the Python OSC GUI
echo Starting Python OSC Control Panel...
python python-osc-gui.py

pause
