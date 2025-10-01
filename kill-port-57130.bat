@echo off
echo Killing processes on port 57130 only...
echo.

REM Find processes using port 57130
netstat -ano | findstr :57130 >nul
if %errorlevel% neq 0 (
    echo No processes found using port 57130
    pause
    exit /b 0
)

echo Found processes using port 57130:
netstat -ano | findstr :57130

echo.
echo Killing processes...

REM Get PIDs and kill them
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :57130') do (
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

echo.
echo Checking if port 57130 is now free...
netstat -ano | findstr :57130 >nul
if %errorlevel% neq 0 (
    echo ✅ Port 57130 is now free
) else (
    echo ❌ Port 57130 is still in use:
    netstat -ano | findstr :57130
)

echo.
echo Port 57121 status (should still be free):
netstat -ano | findstr :57121 >nul
if %errorlevel% neq 0 (
    echo ✅ Port 57121 is free
) else (
    echo 🔄 Port 57121 still in use:
    netstat -ano | findstr :57121
)

echo.
pause

