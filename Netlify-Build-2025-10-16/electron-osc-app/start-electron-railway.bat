@echo off
echo 🚀 Starting Electron OSC Control with Railway...
echo.

echo 📡 Using Railway API: https://ros-50-production.up.railway.app
echo 🎵 OSC Port: 57121
echo.

echo 🔧 Installing dependencies...
call npm install

echo.
echo 🎯 Starting Electron app...
npm start

pause
