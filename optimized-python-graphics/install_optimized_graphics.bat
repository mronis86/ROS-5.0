@echo off
echo Installing Optimized Live Graphics Generator...
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.8+ from https://python.org
    pause
    exit /b 1
)

echo Python found. Installing dependencies...
echo.

REM Install requirements from current directory
pip install -r optimized_requirements.txt

if errorlevel 1 (
    echo.
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo ✅ Installation complete!
echo.
echo To run the optimized graphics generator:
echo   run_optimized_graphics.bat
echo   OR
echo   python optimized_live_graphics_generator.py
echo.
pause
