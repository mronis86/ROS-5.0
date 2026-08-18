@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo Python is not installed or not on PATH.
  pause
  exit /b 1
)

echo Installing PyInstaller + app deps...
python -m pip uninstall typing -y >nul 2>&1
python -m pip install -r requirements.txt pyinstaller
if errorlevel 1 (
  echo pip install failed.
  pause
  exit /b 1
)

echo Building one-file portable exe...
python -m PyInstaller --noconfirm --clean --onefile --windowed --name ROS-HyperDeck-Ingest app.py
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

echo.
echo Built:
echo   %cd%\dist\ROS-HyperDeck-Ingest.exe
echo.
echo Create download zip from repo root:
echo   node scripts/zip-hyperdeck-ingest.js
echo.
echo Copy the zip or exe to the ingest PC — no Python install required.
explorer "%cd%\dist"
pause
endlocal
