@echo off
echo.
echo ========================================
echo   Create ROS-OSC-Control Portable Zip
echo ========================================
echo.

cd /d "%~dp0"

if not exist "ros-osc-control\dist" (
    echo The 'ros-osc-control\dist' folder was not found.
    echo.
    echo Build the portable app first:
    echo   1. cd ros-osc-control
    echo   2. Run build-standalone.bat
    echo.
    echo Then run this script again.
    pause
    exit /b 1
)

echo Zipping ros-osc-control\dist to public\ROS-OSC-Control-portable.zip ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-ros-osc-control-zip.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Failed to create zip.
    pause
    exit /b 1
)

echo.
echo Done. public\ROS-OSC-Control-portable.zip is ready.
echo It will be served by the app and can be downloaded from the OSC modal.
echo.
pause
