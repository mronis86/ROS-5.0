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

echo Starting OSC Server with CLI...
echo.
echo This will start:
echo - Standalone OSC Server (port 57130) - Direct Supabase integration
echo - OSC CLI for testing commands
echo - React app OSC modal will also work (port 3003)
echo.
echo Available sub-timer commands:
echo   /subtimer/cue/5/start  - Start sub-timer for cue 5
echo   /subtimer/cue/5/stop   - Stop sub-timer for cue 5
echo.

echo Starting OSC Server in background...
start /B node osc-websocket-server.js

echo Waiting for server to start...
timeout /t 3 /nobreak > nul

echo Starting OSC CLI...
echo.
node osc-cli.js

pause
