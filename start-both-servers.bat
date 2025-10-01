@echo off
echo Starting React and OSC Servers...
echo.
cd /d "%~dp0"

echo Starting React Development Server...
start "React Server" cmd /k "npm run dev"

echo Waiting 3 seconds for React server to start...
timeout /t 3 /nobreak >nul

echo Starting WebSocket OSC Server...
start "OSC Server" cmd /k "node osc-websocket-server.js"

echo.
echo ✅ Both servers are starting!
echo 🌐 React App will be available at: http://localhost:3003
echo 🎵 OSC Server is running on port: 57121
echo.
echo Press any key to exit this window (servers will continue running)
pause >nul
