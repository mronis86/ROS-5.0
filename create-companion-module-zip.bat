@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-companion-module-zip.ps1"
if %errorlevel% neq 0 (
    echo Failed to create zip.
    exit /b 1
)
echo Done. public\companion-module-runofshow.zip is ready.
