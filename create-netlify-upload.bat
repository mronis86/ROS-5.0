@echo off
cd /d "%~dp0"
echo.
echo Building site and portable zip, then filling netlify-upload...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-netlify-upload.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Build or copy failed.
    pause
    exit /b 1
)
echo.
echo Open the netlify-upload folder and drag it to Netlify Deploys.
pause
