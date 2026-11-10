@echo off
setlocal EnableExtensions
title ROS Offline Kiosk — install / update

REM One-click installer: download this .bat from ROS, run it.
REM Always stops running engines, downloads a fresh zip, unpacks, then starts.

set "INSTALL_ROOT=%LOCALAPPDATA%\ROS-Offline-Kiosk"
set "APP_DIR=%INSTALL_ROOT%\offline-kiosk-v2"
set "ZIP_URL=https://ros1615.pages.dev/offline-kiosk-v2.zip"
set "ZIP_URL_FALLBACK=https://ros1615.netlify.app/offline-kiosk-v2.zip"
set "ZIP_FILE=%TEMP%\ros-offline-kiosk-v2.zip"

echo.
echo ========== ROS Offline Kiosk ==========
echo Install folder: %APP_DIR%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required ^(20+ / 22 LTS recommended^).
  echo Install from https://nodejs.org/ then run this again.
  pause
  exit /b 1
)

for /f "tokens=1 delims=v" %%V in ('node -v 2^>nul') do set "NODE_VER=%%V"
echo Node %NODE_VER%

echo.
echo Stopping any running Offline Kiosk / Offline Show / WebLinked so files unlock...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "Get-CimInstance Win32_Process | Where-Object {" ^
  "  ($_.Name -match '^(electron|ROS Offline Kiosk|ROS Offline Kiosk.exe)$') -or" ^
  "  ($_.CommandLine -and (" ^
  "    $_.CommandLine -match 'offline-kiosk-v2' -or" ^
  "    $_.CommandLine -match 'ROS-Offline-Kiosk' -or" ^
  "    $_.CommandLine -match 'ros-offline-kiosk'" ^
  "  ))" ^
  "} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };" ^
  "Get-CimInstance Win32_Process | Where-Object {" ^
  "  $_.Name -match '^(node|node\\.exe)$' -and $_.CommandLine -and (" ^
  "    $_.CommandLine -match 'offline-show[\\\\/]+server[\\\\/]+server\\.js' -or" ^
  "    ($_.CommandLine -match 'server[\\\\/]+server\\.js' -and $_.CommandLine -match 'offline-show')" ^
  "  )" ^
  "} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };" ^
  "foreach ($img in @('sinor-weblinked.exe','weblinked.exe')) {" ^
  "  & taskkill.exe /F /IM $img /T 2>$null | Out-Null" ^
  "};" ^
  "$conns = Get-NetTCPConnection -LocalPort 3004 -State Listen -ErrorAction SilentlyContinue;" ^
  "foreach ($c in @($conns)) { if ($c.OwningProcess) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } }"
timeout /t 2 /nobreak >nul

echo.
echo Downloading Offline Kiosk package...
if not exist "%INSTALL_ROOT%" mkdir "%INSTALL_ROOT%"
if exist "%ZIP_FILE%" del /f /q "%ZIP_FILE%" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$urls=@($env:ZIP_URL,$env:ZIP_URL_FALLBACK); $out=$env:ZIP_FILE; $ok=$false;" ^
  "foreach($u in $urls){ if([string]::IsNullOrWhiteSpace($u)){continue}; try { Write-Host ('GET '+$u); Invoke-WebRequest -Uri $u -OutFile $out -UseBasicParsing; if((Get-Item $out).Length -gt 10000){ $ok=$true; break } } catch { Write-Host ('  failed: '+$_.Exception.Message) } };" ^
  "if(-not $ok){ throw 'Could not download offline-kiosk-v2.zip from Pages/Netlify.' }"
if errorlevel 1 (
  echo.
  echo Download failed. Check internet / VPN, or open:
  echo   %ZIP_URL%
  pause
  exit /b 1
)

echo Unpacking...
if exist "%APP_DIR%" (
  rmdir /s /q "%APP_DIR%" 2>nul
  if exist "%APP_DIR%" (
    echo.
    echo Could not remove old folder — something still has it locked.
    echo Run launcher\STOP-KIOSK.bat, wait a few seconds, then try again.
    pause
    exit /b 1
  )
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "Expand-Archive -LiteralPath $env:ZIP_FILE -DestinationPath $env:INSTALL_ROOT -Force;" ^
  "if(-not (Test-Path (Join-Path $env:APP_DIR 'package.json'))){ throw 'Unpack succeeded but package.json missing — unexpected zip layout.' }"
if errorlevel 1 (
  echo Unpack failed.
  pause
  exit /b 1
)
del /f /q "%ZIP_FILE%" >nul 2>&1
echo Package ready.

cd /d "%APP_DIR%"
if errorlevel 1 (
  echo Could not open %APP_DIR%
  pause
  exit /b 1
)

echo.
echo Checking Electron / kiosk npm deps...
if not exist "node_modules\electron" (
  echo Installing kiosk dependencies ^(first run^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo npm install failed in kiosk root.
    pause
    exit /b 1
  )
) else (
  echo Kiosk node_modules OK.
)

if exist "engines\offline-show\package.json" (
  echo.
  echo Checking Offline Show engine...
  pushd "engines\offline-show"
  if not exist "node_modules" (
    echo Installing Offline Show server deps...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
      echo Offline Show npm install failed.
      popd
      pause
      exit /b 1
    )
  )
  if exist "launcher\bootstrap.bat" (
    call "launcher\bootstrap.bat" --skip-ui-build
    if errorlevel 1 (
      echo UI missing — running full Offline Show bootstrap...
      call "launcher\bootstrap.bat"
      if errorlevel 1 (
        echo Offline Show bootstrap failed.
        popd
        pause
        exit /b 1
      )
    )
  )
  popd
)

echo.
echo Starting ROS Offline Kiosk...
call npm start
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo.
  echo Kiosk exited with code %EXITCODE%.
  pause
)
endlocal & exit /b %EXITCODE%
