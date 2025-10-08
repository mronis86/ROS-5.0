@echo off
echo 🚀 Starting Netlify deployment process...

echo 📦 Installing dependencies...
call npm install

echo 🔨 Building project for production...
call npm run build

if %errorlevel% equ 0 (
    echo ✅ Build successful!
    echo 📁 Build output is in the 'dist' folder
    echo 🌐 Ready for Netlify deployment
) else (
    echo ❌ Build failed!
    exit /b 1
)

echo 🎉 Deployment preparation complete!
echo.
echo Next steps:
echo 1. Commit your changes to git
echo 2. Push to your GitHub repository
echo 3. Connect your repository to Netlify
echo 4. Configure environment variables in Netlify dashboard
echo 5. Deploy!
pause
