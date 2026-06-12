@echo off
setlocal
pushd "%~dp0.."
if errorlevel 1 (
  echo Could not open offline-show folder.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed or not on PATH.
  echo Install from https://nodejs.org/ then run this again.
  popd
  pause
  exit /b 1
)

node scripts\bootstrap.js %*
if errorlevel 1 (
  echo Bootstrap failed.
  popd
  pause
  exit /b 1
)

popd
exit /b 0
