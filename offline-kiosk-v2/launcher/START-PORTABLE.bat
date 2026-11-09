@echo off
setlocal
cd /d "%~dp0"

REM Portable Offline Kiosk — no system Node/npm required.
REM Double-click this file (or the "ROS Offline Kiosk.exe" next to it).

set "EXE="
if exist "%~dp0ROS Offline Kiosk.exe" set "EXE=%~dp0ROS Offline Kiosk.exe"
if not defined EXE if exist "%~dp0ROS-Offline-Kiosk.exe" set "EXE=%~dp0ROS-Offline-Kiosk.exe"

if not defined EXE (
  echo Could not find ROS Offline Kiosk.exe in this folder.
  echo Unzip the full portable package, then run START.bat again.
  pause
  exit /b 1
)

if not exist "%~dp0resources\engines\weblinked\sinor-weblinked.exe" (
  if not exist "%~dp0resources\engines\weblinked\weblinked.exe" (
    echo WARNING: WebLinked runtime missing under resources\engines\weblinked
    echo Displays / SDI will not work until this package includes WebLinked.
    echo.
  )
)

REM Clear Mark-of-the-Web from downloaded zips so WebLinked/CEF is not blocked/hung.
powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%~dp0resources\engines\weblinked' -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1

start "" "%EXE%"
endlocal
