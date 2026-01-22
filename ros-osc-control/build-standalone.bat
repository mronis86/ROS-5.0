@echo off
echo.
echo ========================================
echo   Building ROS OSC Control Standalone
echo ========================================
echo.

cd /d "%~dp0"

echo Step 1: Installing dependencies...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ Failed to install dependencies!
    echo Make sure you have Node.js and npm installed.
    pause
    exit /b 1
)

echo.
echo Step 2: Building standalone portable executable...
echo This will create a single .exe file with all dependencies bundled.
echo.

call npm run build:portable

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ Build failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo   ✅ Build Complete!
echo ========================================
echo.
echo The standalone executable is in the 'dist' folder:
echo   dist\ROS-OSC-Control-1.0.0-portable.exe
echo.
echo This file can be copied to any Windows computer and run
echo without needing to install Node.js, npm, or any dependencies!
echo.
pause
