@echo off
REM Pack Cloudflare folder (R2 large zips) + deploy to ros1615 Pages
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-cloudflare-pages.ps1"
pause
