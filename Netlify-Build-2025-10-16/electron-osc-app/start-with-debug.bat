@echo off
echo.
echo ========================================
echo   ROS OSC Control - DEBUG MODE
echo ========================================
echo.

cd /d "%~dp0"

echo Current directory: %CD%
echo.

REM Check if node_modules exists
if exist "node_modules" (
    echo ✅ node_modules found
) else (
    echo ❌ node_modules NOT found - running npm install...
    npm install
    if errorlevel 1 (
        echo.
        echo ❌ npm install FAILED!
        pause
        exit /b 1
    )
)
echo.

REM Check if package.json exists
if exist "package.json" (
    echo ✅ package.json found
) else (
    echo ❌ package.json NOT found!
    pause
    exit /b 1
)
echo.

REM Check if socket.io-client is installed
echo Checking for socket.io-client...
if exist "node_modules\socket.io-client" (
    echo ✅ socket.io-client installed
) else (
    echo ❌ socket.io-client NOT found - installing...
    npm install socket.io-client@4.5.4
)
echo.

echo Starting app...
echo.
npm start

if errorlevel 1 (
    echo.
    echo ❌ App failed to start!
    echo Check the error message above.
)

echo.
pause

