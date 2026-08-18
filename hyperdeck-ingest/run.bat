@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo Python is not installed or not on PATH.
  echo Install Python 3.10+ from https://www.python.org then try again,
  echo or use build-portable.bat to make a double-click exe.
  pause
  exit /b 1
)

python -c "import tkinter, requests" 2>nul
if errorlevel 1 (
  echo Installing dependencies...
  python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo pip install failed.
    pause
    exit /b 1
  )
)

echo Starting ROS HyperDeck Ingest...
python app.py
if errorlevel 1 (
  echo.
  echo App exited with an error.
  pause
)
endlocal
