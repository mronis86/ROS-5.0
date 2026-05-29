@echo off
:: Allow inbound TCP 3004 so iPad / other PCs on Wi-Fi can reach the show server.
:: MUST run as Administrator (right-click -> Run as administrator).
echo.
echo ROS Offline Show — Windows Firewall (port 3004)
echo.

netsh advfirewall firewall show rule name="ROS Offline Show 3004" >nul 2>&1
if %errorlevel%==0 (
  echo Rule already exists. Updating to allow Private + Public networks...
  netsh advfirewall firewall delete rule name="ROS Offline Show 3004" >nul 2>&1
)

netsh advfirewall firewall add rule name="ROS Offline Show 3004" dir=in action=allow protocol=TCP localport=3004 profile=any enable=yes
if errorlevel 1 (
  echo.
  echo FAILED — Right-click this file and choose "Run as administrator".
  echo Without this, other devices get Chrome "chrome-error" / cannot connect.
  echo.
  pause
  exit /b 1
)

echo.
echo OK — inbound TCP 3004 allowed on all network profiles.
echo Other devices can use: http://YOUR-PC-IP:3004/
echo.
pause
