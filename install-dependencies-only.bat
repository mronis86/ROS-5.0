@echo off
echo Installing OSC Server Dependencies...
echo.

REM Rename osc-package.json to package.json if it exists
if exist "osc-package.json" (
    echo Setting up package.json...
    copy "osc-package.json" "package.json" >nul
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing npm dependencies...
    echo This may take a few minutes...
    echo.
    npm install
    if %errorlevel% neq 0 (
        echo.
        echo ❌ Error: Failed to install dependencies. Make sure Node.js and npm are installed.
        echo.
        echo Please check:
        echo 1. Node.js is installed (run: node --version)
        echo 2. npm is installed (run: npm --version)
        echo 3. You have internet connection
        echo.
        pause
        exit /b 1
    )
    echo.
    echo ✅ Dependencies installed successfully!
    echo.
) else (
    echo ✅ Dependencies already installed.
    echo.
)

echo 🎉 Setup complete! You can now run:
echo   - start-osc-server.bat (OSC server only)
echo   - start-osc-with-cli.bat (OSC server + CLI)
echo   - kill-osc-port.bat (kill processes on port 57130)
echo.
pause

