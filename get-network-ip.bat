@echo off
echo.
echo ========================================
echo   YOUR LOCAL NETWORK IP ADDRESS
echo ========================================
echo.
echo Finding your IP address for network access...
echo.

ipconfig | findstr /i "IPv4"

echo.
echo ========================================
echo   HOW TO ACCESS FROM OTHER DEVICES
echo ========================================
echo.
echo 1. API Server (port 3001):
echo    http://YOUR-IP:3001
echo.
echo 2. React App (port 3003+):
echo    http://YOUR-IP:3003
echo.
echo 3. Replace YOUR-IP with the IPv4 address shown above
echo.
echo Example:
echo    If IPv4 is 192.168.1.100
echo    Then use: http://192.168.1.100:3001
echo.
echo ========================================
echo.
pause

