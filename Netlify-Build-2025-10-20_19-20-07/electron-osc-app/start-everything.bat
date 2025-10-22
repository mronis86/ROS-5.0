@echo off
echo.
echo ========================================
echo   ROS OSC Control - Starting Everything
echo ========================================
echo.

REM Get the directory where this batch file is located
set "OSC_DIR=%~dp0"
REM Get the parent directory (ROS-5.0)
for %%I in ("%OSC_DIR%..") do set "ROOT_DIR=%%~fI"

echo OSC Control folder: %OSC_DIR%
echo Root folder: %ROOT_DIR%
echo.

REM Step 1: Install dependencies if needed
echo [Step 1/3] Checking dependencies...
cd /d "%OSC_DIR%"

if not exist "node_modules" (
    echo Installing OSC Control dependencies...
    echo This may take a few minutes...
    call npm install
    if errorlevel 1 (
        echo.
        echo ❌ npm install failed!
        echo Please run: npm install manually
        pause
        exit /b 1
    )
    echo.
) else (
    echo Dependencies already installed.
    echo.
)

REM Step 2: Start API server in new window
echo [Step 2/3] Starting API server...
cd /d "%ROOT_DIR%"

if not exist "api-server.js" (
    echo ❌ Error: api-server.js not found in %ROOT_DIR%
    pause
    exit /b 1
)

start "ROS API Server" cmd /k "cd /d "%ROOT_DIR%" && echo Starting API Server... && node api-server.js"
echo API Server started in new window
echo.

REM Wait a moment for API server to start
echo Waiting 3 seconds for API server to initialize...
timeout /t 3 /nobreak >nul
echo.

REM Step 3: Start OSC Control app
echo [Step 3/3] Starting OSC Control app...
cd /d "%OSC_DIR%"
echo.
echo ========================================
echo   Both servers starting!
echo ========================================
echo.
echo - API Server: Running in separate window
echo - OSC Control: Starting now...
echo.
echo Close this window to stop OSC Control
echo (API server will keep running in its own window)
echo.

npm start

echo.
echo OSC Control app closed.
pause
