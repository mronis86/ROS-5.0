@echo off
echo Installing OSC Server Dependencies...
echo.

REM Rename osc-package.json to package.json if it exists
if exist "osc-package.json" (
    echo Setting up package.json...
    copy "osc-package.json" "package.json" >nul
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing npm dependencies...
    npm install
    if %errorlevel% neq 0 (
        echo Error: Failed to install dependencies. Make sure Node.js and npm are installed.
        pause
        exit /b 1
    )
    echo.
    echo Dependencies installed successfully!
    echo.
) else (
    echo Dependencies already installed.
    echo.
)

echo Starting OSC Server...
echo This will start the standalone OSC server with network access
echo.
echo Server will be available on your network IP address
echo.
node osc-websocket-server.js
pause
