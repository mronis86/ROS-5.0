@echo off
echo ========================================
echo   ROS Local Server (Python Version)
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH!
    echo.
    echo Please download and install Python from:
    echo https://www.python.org/downloads/
    echo.
    echo Make sure to check "Add Python to PATH" during installation!
    pause
    exit /b 1
)

echo Python found!
echo.

REM Check if requirements are installed
pip show psycopg2-binary >nul 2>&1
if errorlevel 1 (
    echo Installing Python dependencies...
    echo This will take a few minutes the first time.
    echo.
    pip install -r requirements.txt
    echo.
    echo Dependencies installed!
    echo.
)

echo Starting Python Server...
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

python server.py

pause

