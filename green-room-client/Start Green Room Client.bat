@echo off
title ROS Green Room Client
cd /d "%~dp0"

REM Portable: Windows only needs PowerShell (built-in). No Node / npm install.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0GreenRoomClient.ps1"
echo.
echo Client stopped. Press any key to close…
pause >nul
