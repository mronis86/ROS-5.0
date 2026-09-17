@echo off
setlocal
title Companion TLS Fix ON (options 3+4)
cd /d "%~dp0"

echo.
echo === Companion TLS Fix ON ===
echo Downloads API certs, then starts Companion with:
echo   NODE_EXTRA_CA_CERTS
echo   NODE_TLS_REJECT_UNAUTHORIZED=0
echo.
echo Close Companion completely first (including tray icon).
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_run-tls-fix-on.ps1"
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo FAILED with exit code %ERR%.
  pause
  exit /b %ERR%
)
echo Done. Check the Run of Show module log in Companion.
pause
endlocal
