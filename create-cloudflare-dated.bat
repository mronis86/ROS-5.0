@echo off
REM Build cloudflare-YYYY-MM-DD-V2 for Cloudflare Pages upload
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-cloudflare-dated.ps1"
pause
