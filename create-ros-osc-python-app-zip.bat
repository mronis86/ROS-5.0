@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-ros-osc-python-app-zip.ps1"
if errorlevel 1 (
    echo Failed to create zip.
    pause
    exit /b 1
)
