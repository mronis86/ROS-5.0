@echo off
setlocal
title Companion Normal (TLS fix OFF)
cd /d "%~dp0"

echo.
echo === Companion Normal Start (TLS fix OFF) ===
echo Starts Companion WITHOUT NODE_EXTRA_CA_CERTS / NODE_TLS_REJECT_UNAUTHORIZED.
echo.
echo Close Companion completely first (including tray icon).
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_run-tls-fix-off.ps1"
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo FAILED with exit code %ERR%.
  pause
  exit /b %ERR%
)
echo Done. Companion should be running normally.
pause
endlocal
