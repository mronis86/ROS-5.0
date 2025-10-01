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

echo Starting OSC Server in background...
start /B node osc-server-fresh.js

echo Waiting for server to start...
timeout /t 3 /nobreak > nul

echo Starting OSC CLI...
echo.
node osc-cli.js

pause
