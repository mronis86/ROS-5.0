@echo off
setlocal

echo ========================================
echo   Build portable EXE
echo   ROS vMix DataSource Bridge
echo ========================================
echo.

cd /d "%~dp0"
if errorlevel 1 (
  echo Could not open vmix-datasource-bridge folder.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed or not on PATH.
  pause
  exit /b 1
)

if not exist "node_modules\electron-builder\package.json" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Building Windows portable exe...
call npm run build:portable
if errorlevel 1 (
  echo.
  echo Build failed.
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Build complete
echo ========================================
echo.
echo Look in:
echo   %cd%\dist\
echo for ROS-vMix-DataSource-Bridge-*-portable.exe
echo.
explorer "%cd%\dist"
pause
endlocal
