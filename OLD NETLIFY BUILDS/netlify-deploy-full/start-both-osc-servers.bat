@echo off
echo Starting Both OSC Servers...
echo.
echo This will start:
echo - Standalone OSC Server (port 57130) - Direct Supabase integration
echo - WebSocket OSC Server (port 57121) - Browser bridge to standalone server
echo.
echo The WebSocket server forwards messages to the standalone server.
echo.

echo Starting Standalone OSC Server in new window...
start "Standalone OSC Server" cmd /k "node osc-server-fresh.js"

echo Waiting for standalone server to start...
timeout /t 3 /nobreak > nul

echo Starting WebSocket OSC Server in new window...
start "WebSocket OSC Server" cmd /k "node osc-websocket-server.js"

echo Waiting for WebSocket server to start...
timeout /t 3 /nobreak > nul

echo.
echo Both servers are now running in separate windows:
echo - Standalone OSC Server: localhost:57130
echo - WebSocket OSC Server: localhost:57121
echo.
echo The OSC Modal in the browser will connect to the WebSocket server,
echo which will forward messages to the standalone server.
echo.

pause
