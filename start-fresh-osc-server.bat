@echo off
echo Starting Fresh Standalone OSC Server...
echo.
echo This server will:
echo - Connect directly to Supabase
echo - Update database in real-time
echo - Work when browser is closed
echo - Support multiple users
echo.
echo OSC Server runs on: localhost:57130
echo Press Ctrl+C to stop the server
echo.
node osc-server-fresh.js
pause
