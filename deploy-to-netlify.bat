@echo off
echo ========================================
echo Netlify Deployment Script
echo ========================================
echo.

REM Check if Netlify CLI is installed
where netlify >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Netlify CLI not found. Installing...
    npm install -g netlify-cli
    if %ERRORLEVEL% NEQ 0 (
        echo Failed to install Netlify CLI. Please install Node.js first.
        pause
        exit /b 1
    )
)

echo Netlify CLI is ready!
echo.

REM Login to Netlify
echo Step 1: Logging in to Netlify...
netlify login

echo.
echo Step 2: Deploying to production...
echo.

REM Deploy the site
netlify deploy --prod --dir=netlify-deploy-final-updated

echo.
echo ========================================
echo Deployment Complete!
echo ========================================
echo.
echo Next steps:
echo 1. Go to your Netlify dashboard
echo 2. Navigate to Site configuration -^> Environment variables
echo 3. Add NEON_DATABASE_URL if not already there
echo 4. Test your functions at the debug page
echo.
pause
