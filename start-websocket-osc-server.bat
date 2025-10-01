@echo off
echo Starting WebSocket OSC Server...
echo.
cd /d "%~dp0"
node osc-websocket-server.js
pause
