@echo off
setlocal
cd /d "%~dp0"
title ROS PowerPoint Bridge

echo.
echo ROS PowerPoint Bridge
echo Unzip the whole folder first. Do not run this from inside the zip window.
echo.

if exist "%~dp0ROS PowerPoint Bridge.exe" goto :runexe
if exist "%~dp0dist\win-unpacked\ROS PowerPoint Bridge.exe" goto :rundist

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: This zip has no prebuilt app, and Node.js is not installed.
  echo Download the latest PowerPoint Bridge zip from ROS, or install Node.js LTS, then run START.bat again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo Installing Electron. This can take a few minutes...
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: npm install failed. Check the lines above.
    pause
    exit /b 1
  )
)

echo Starting from source...
call npm start
if errorlevel 1 (
  echo.
  echo ERROR: Electron failed to start. Check the lines above.
  pause
  exit /b 1
)
goto :eof

:runexe
echo Starting ROS PowerPoint Bridge...
start "" "%~dp0ROS PowerPoint Bridge.exe"
goto :eof

:rundist
echo Starting ROS PowerPoint Bridge...
start "" "%~dp0dist\win-unpacked\ROS PowerPoint Bridge.exe"
goto :eof
