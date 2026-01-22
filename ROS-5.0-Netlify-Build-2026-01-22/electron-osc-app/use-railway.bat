@echo off
echo.
echo Switching to RAILWAY mode...
echo.

cd /d "%~dp0"

copy /Y .env.railway .env

echo.
echo ✅ Now using RAILWAY mode!
echo.
echo Railway URL: https://ros-50-production.up.railway.app
echo.
echo You can now start the app with: npm start
echo.
pause

