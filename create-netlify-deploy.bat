@echo off
cd /d "%~dp0"
echo.
echo Building site and portable zip, then filling dated netlify folder...
echo (Uses netlify-YYYY-MM-DD-V2 — forces fresh deploy when uploaded to Netlify)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-netlify-dated.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Build or copy failed.
    pause
    exit /b 1
)
echo.
echo Open the netlify-*-V2 folder and drag it to Netlify Deploys.
pause