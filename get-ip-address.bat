@echo off
echo Finding your computer's IP address...
echo.
echo Your computer's IP addresses:
echo.
ipconfig | findstr "IPv4"
echo.
echo Use one of these IP addresses in the OSC Control panel
echo (usually the one that starts with 192.168.x.x or 10.x.x.x)
echo.
pause
