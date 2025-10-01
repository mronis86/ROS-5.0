@echo off
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

echo Killing any existing Node.js processes...
taskkill /f /im node.exe >nul 2>&1

echo Starting OSC Server in background...
start /B node osc-server-fresh.js

echo Waiting for server to fully start (this may take up to 10 seconds)...
timeout /t 8 /nobreak > nul

echo Checking if server is running...
netstat -ano | findstr :57130 >nul
if %errorlevel% == 0 (
    echo ✅ Server is running on port 57130
    echo Starting OSC CLI...
    echo.
    node osc-cli.js
) else (
    echo ❌ Server failed to start. Check for errors above.
    echo Press any key to exit...
    pause >nul
)

pause
