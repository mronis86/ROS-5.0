@echo off
title ROS Green Room Client
cd /d "%~dp0"

REM Portable tray app: no Node / npm / installer.
REM First run may show a setup window for the Integration token.
REM After that it lives in the system tray (by the clock).

where powershell >nul 2>&1
if errorlevel 1 (
  echo PowerShell is required.
  pause
  exit /b 1
)

REM Prefer Windows PowerShell 5.1 (WinForms tray). Hide console after launch.
start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0GreenRoomClient.ps1"
exit /b 0
