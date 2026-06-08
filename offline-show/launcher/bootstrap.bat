@echo off
setlocal
cd /d "%~dp0.."

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed or not on PATH.
  echo Install from https://nodejs.org/ then run this again.
  pause
  exit /b 1
)

node scripts\bootstrap.js %*
if errorlevel 1 (
  echo Bootstrap failed.
  pause
  exit /b 1
)

exit /b 0
