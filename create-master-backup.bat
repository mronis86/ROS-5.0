@echo off
cd /d "%~dp0"
echo.
echo Full backup zip of master (all tracked files, same as GitHub)...
echo Output: ROS-5.0-master-backup-YYYY-MM-DD.zip
echo.
node scripts/zip-master-backup.js --branch master
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Failed.
    pause
    exit /b 1
)
echo.
pause
