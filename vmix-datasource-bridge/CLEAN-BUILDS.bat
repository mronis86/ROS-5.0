@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   Clean build caches (keep source)
echo ========================================
echo.
echo This removes node_modules + Electron build folders so the
echo directory is small again. Re-run install-dependencies.bat
echo or START.bat afterward if you need to develop locally.
echo.

if exist "node_modules\" (
  echo Removing node_modules...
  rmdir /s /q "node_modules"
)
if exist "dist\" rmdir /s /q "dist"
if exist "dist-transfer\" rmdir /s /q "dist-transfer"
for /d %%D in (dist-ready-*) do (
  echo Removing %%D...
  rmdir /s /q "%%D"
)

echo.
echo Done. Source files remain. Folder should be only a few MB.
pause
endlocal
