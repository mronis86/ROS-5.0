@echo off
setlocal EnableDelayedExpansion

echo ========================================
echo   ROS Offline Show
echo ========================================
echo.

pushd "%~dp0.."
if errorlevel 1 (
  echo Could not open offline-show folder.
  pause
  exit /b 1
)

call "%~dp0bootstrap.bat" --skip-ui-build
if errorlevel 1 (
  popd
  exit /b 1
)

if not exist "ui\dist\index.html" (
  echo UI build missing. Running full bootstrap with UI build...
  call "%~dp0bootstrap.bat"
  if errorlevel 1 (
    popd
    exit /b 1
  )
)

echo Stopping anything on port 3004...
call npx --yes kill-port 3004 2>nul

echo Starting show server on port 3004...
start "ROS Offline Show" cmd /k "%~dp0_start-server-window.bat"

echo Waiting for server...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wait-for-server.ps1"
if errorlevel 1 (
  echo Server did not start. Check the "ROS Offline Show" window for errors.
  popd
  pause
  exit /b 1
)

echo Opening browser...
set "LAN_IP="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0get-lan-ip.ps1"`) do set "LAN_IP=%%I"
if defined LAN_IP (
  echo LAN devices: http://!LAN_IP!:3004/
)
start "" "http://127.0.0.1:3004/"

echo.
echo This PC: http://127.0.0.1:3004/
echo First run installs Node dependencies automatically ^(requires internet^).
echo If LAN fails, run allow-lan-firewall.bat as Administrator.
echo.
popd
pause
endlocal
