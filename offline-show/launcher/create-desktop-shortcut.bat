@echo off
setlocal
echo Creating ROS Offline Show desktop shortcut with icon...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-desktop-shortcut.ps1"
if errorlevel 1 (
  echo.
  echo Shortcut creation failed.
  pause
  exit /b 1
)
echo.
pause
endlocal
