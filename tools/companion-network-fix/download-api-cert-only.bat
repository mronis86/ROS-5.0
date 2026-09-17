@echo off
setlocal
title Download ROS API cert chain
cd /d "%~dp0"

echo.
echo === Download API certificate chain ===
echo Target: https://ros-50-production.up.railway.app/health
echo Saves into: %~dp0certs\
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_download-cert-only.ps1"
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo FAILED with exit code %ERR%.
  pause
  exit /b %ERR%
)
echo Done.
pause
endlocal
