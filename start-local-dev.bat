@echo off
echo ========================================
echo Starting Local Development Environment
echo ========================================
echo.

echo Starting Local API + WebSocket Server (Port 3002)...
start "Local API Server" cmd /k "cd local-server && node server.js"
timeout /t 3 /nobreak >nul

echo.
echo Starting React Dev Server (Port 3003)...
start "React Dev Server" cmd /k "npm run dev"

echo.
echo ========================================
echo Both servers are starting!
echo ========================================
echo.
echo Local API Server:  http://localhost:3002
echo React App:         http://localhost:3003
echo Network Access:    http://192.168.1.232:3003
echo.
echo Press any key to close this window...
pause >nul

