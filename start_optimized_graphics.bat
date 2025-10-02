@echo off
echo Starting Optimized Python Live Graphics Generator...
echo.

REM Change to the optimized graphics directory
cd optimized-python-graphics

REM Check if the directory exists
if not exist "optimized_live_graphics_generator.py" (
    echo ERROR: Optimized graphics folder not found
    echo Please ensure the optimized-python-graphics folder exists
    pause
    exit /b 1
)

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
    echo Dependencies not found. Installing...
    echo.
    call install_optimized_graphics.bat
    if errorlevel 1 (
        echo.
        echo Installation failed. Please check the error messages above.
        pause
        exit /b 1
    )
)

echo Starting application...
echo.

REM Run the optimized graphics generator
python optimized_live_graphics_generator.py

if errorlevel 1 (
    echo.
    echo Application exited with an error
    pause
)
