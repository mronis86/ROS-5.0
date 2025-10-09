@echo off
echo ========================================
echo Starting Local API + WebSocket Server
echo ========================================
echo.
echo This server provides:
echo - REST API endpoints
echo - WebSocket support
echo - XML/CSV for VMIX
echo - Connected to Neon database
echo.
echo Starting server on port 3002...
echo.

node server.js

echo.
echo Server stopped.
pause
