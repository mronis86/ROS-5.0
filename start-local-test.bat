@echo off
echo ================================================
echo    Local Server Test - Neon Database
echo ================================================
echo.

REM Check if NEON_DATABASE_URL is set
if "%NEON_DATABASE_URL%"=="" (
    echo [ERROR] NEON_DATABASE_URL environment variable not set!
    echo.
    echo Please set it using one of these methods:
    echo.
    echo Method 1: Set in current session
    echo   set NEON_DATABASE_URL=postgresql://username:password@ep-xyz.neon.tech/neondb?sslmode=require
    echo.
    echo Method 2: Set permanently (Administrator)
    echo   setx NEON_DATABASE_URL "postgresql://username:password@ep-xyz.neon.tech/neondb?sslmode=require"
    echo.
    echo After setting the variable, run this script again.
    pause
    exit /b 1
)

echo [OK] NEON_DATABASE_URL is set
echo.
echo Database host: 
echo %NEON_DATABASE_URL% | findstr "@"
echo.

REM Check if pg package is installed
echo Checking dependencies...
npm list pg >nul 2>&1
if errorlevel 1 (
    echo [WARNING] PostgreSQL 'pg' package not found
    echo Installing now...
    npm install pg
    if errorlevel 1 (
        echo [ERROR] Failed to install pg package
        pause
        exit /b 1
    )
)
echo [OK] Dependencies installed
echo.

echo ================================================
echo    Starting Local Server (Port 3002)
echo ================================================
echo.
echo Server will start in a new window...
echo Keep that window open while testing.
echo.
echo This window will run the test script.
echo.
pause

REM Start server in new window
start "Local Server - Port 3002" cmd /k "node server.js"

REM Wait for server to start
echo Waiting for server to start...
timeout /t 3 /nobreak >nul

echo.
echo ================================================
echo    Running Tests
echo ================================================
echo.

REM Run test script
node test-local-server.js

echo.
echo ================================================
echo    Testing Complete
echo ================================================
echo.
echo Press any key to stop the server and exit...
pause >nul

REM Try to close the server window (may not work on all systems)
taskkill /FI "WINDOWTITLE eq Local Server*" /T /F >nul 2>&1

echo.
echo Server stopped. Goodbye!
timeout /t 2 /nobreak >nul

