@echo off
echo.
echo ========================================
echo   Install ROS vMix DataSource Bridge deps
echo ========================================
echo.

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed or not on PATH.
  pause
  exit /b 1
)

echo Installing npm packages...
call npm install
if errorlevel 1 (
  echo.
  echo Installation failed.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Installation complete
echo ========================================
echo.
echo Start the app with:
echo   START.bat
echo   or launcher\start-ros-vmix-datasource.bat
echo.
pause
