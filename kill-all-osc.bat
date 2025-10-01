@echo off
echo Killing ALL OSC-related processes...
echo.

echo Checking for processes on common OSC ports:
echo.

REM Kill port 57121
echo === Port 57121 ===
netstat -ano | findstr :57121 >nul
if %errorlevel% neq 0 (
    echo No processes on port 57121
) else (
    echo Found processes on port 57121:
    netstat -ano | findstr :57121
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :57121') do (
        if not "%%a"=="0" (
            echo Killing process %%a...
            taskkill /F /PID %%a >nul 2>&1
        )
    )
)

echo.
echo === Port 57130 ===
netstat -ano | findstr :57130 >nul
if %errorlevel% neq 0 (
    echo No processes on port 57130
) else (
    echo Found processes on port 57130:
    netstat -ano | findstr :57130
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :57130') do (
        if not "%%a"=="0" (
            echo Killing process %%a...
            taskkill /F /PID %%a >nul 2>&1
        )
    )
)

echo.
echo === Port 3003 (React App) ===
netstat -ano | findstr :3003 >nul
if %errorlevel% neq 0 (
    echo No processes on port 3003
) else (
    echo Found processes on port 3003:
    netstat -ano | findstr :3003
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3003') do (
        if not "%%a"=="0" (
            echo Killing process %%a...
            taskkill /F /PID %%a >nul 2>&1
        )
    )
)

echo.
echo === Port 3004 (React App) ===
netstat -ano | findstr :3004 >nul
if %errorlevel% neq 0 (
    echo No processes on port 3004
) else (
    echo Found processes on port 3004:
    netstat -ano | findstr :3004
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3004') do (
        if not "%%a"=="0" (
            echo Killing process %%a...
            taskkill /F /PID %%a >nul 2>&1
        )
    )
)

echo.
echo === Final Status ===
echo Port 57121: 
netstat -ano | findstr :57121 >nul && echo STILL IN USE || echo FREE
echo Port 57130: 
netstat -ano | findstr :57130 >nul && echo STILL IN USE || echo FREE
echo Port 3003: 
netstat -ano | findstr :3003 >nul && echo STILL IN USE || echo FREE
echo Port 3004: 
netstat -ano | findstr :3004 >nul && echo STILL IN USE || echo FREE

echo.
pause

