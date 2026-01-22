@echo off
echo.
echo ========================================
echo   Installing ROS OSC Control Dependencies
echo ========================================
echo.

cd /d "%~dp0"

echo Installing npm packages...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ Installation failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo   ✅ Installation Complete!
echo ========================================
echo.
echo You can now run the app with:
echo   start-everything.bat
echo.
pause

