@echo off
echo Killing OSC processes on ports 57121 and 57130...
echo.

REM Function to kill processes on a specific port
call :KillPort 57121
call :KillPort 57130

echo.
echo Checking final status...
echo.

echo Port 57121 status:
netstat -ano | findstr :57121 >nul
if %errorlevel% neq 0 (
    echo ✅ Port 57121 is free
) else (
    echo ❌ Port 57121 still in use:
    netstat -ano | findstr :57121
)

echo.
echo Port 57130 status:
netstat -ano | findstr :57130 >nul
if %errorlevel% neq 0 (
    echo ✅ Port 57130 is free
) else (
    echo ❌ Port 57130 still in use:
    netstat -ano | findstr :57130
)

echo.
pause
exit /b

:KillPort
set PORT=%1
echo Checking port %PORT%...

REM Find processes using the port
netstat -ano | findstr :%PORT% >nul
if %errorlevel% neq 0 (
    echo No processes found using port %PORT%
    goto :eof
)

echo Found processes using port %PORT%:
netstat -ano | findstr :%PORT%

echo.
echo Killing processes on port %PORT%...

REM Get PIDs and kill them
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT%') do (
    if not "%%a"=="0" (
        echo Killing process %%a...
        taskkill /F /PID %%a >nul 2>&1
        if !errorlevel! equ 0 (
            echo ✅ Successfully killed process %%a
        ) else (
            echo ❌ Failed to kill process %%a
        )
    )
)

echo ✅ Finished checking port %PORT%
echo.
goto :eof
