# Local Server Test - Neon Database
# PowerShell script for testing local server with Neon database

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   Local Server Test - Neon Database" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check if NEON_DATABASE_URL is set
if (-not $env:NEON_DATABASE_URL) {
    Write-Host "[ERROR] NEON_DATABASE_URL environment variable not set!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please set it using one of these methods:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Method 1: Set in current PowerShell session" -ForegroundColor White
    Write-Host '  $env:NEON_DATABASE_URL="postgresql://username:password@ep-xyz.neon.tech/neondb?sslmode=require"' -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Method 2: Set permanently (requires restart)" -ForegroundColor White
    Write-Host '  [System.Environment]::SetEnvironmentVariable("NEON_DATABASE_URL", "your-url-here", "User")' -ForegroundColor Cyan
    Write-Host ""
    Write-Host "After setting the variable, run this script again." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[OK] NEON_DATABASE_URL is set" -ForegroundColor Green
Write-Host ""
$dbHost = ($env:NEON_DATABASE_URL -split '@')[1] -split '/')[0]
Write-Host "Database host: $dbHost" -ForegroundColor Blue
Write-Host ""

# Check if pg package is installed
Write-Host "Checking dependencies..." -ForegroundColor Yellow
$pgInstalled = npm list pg 2>&1 | Select-String "pg@"
if (-not $pgInstalled) {
    Write-Host "[WARNING] PostgreSQL 'pg' package not found" -ForegroundColor Yellow
    Write-Host "Installing now..." -ForegroundColor Yellow
    npm install pg
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Failed to install pg package" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}
Write-Host "[OK] Dependencies installed" -ForegroundColor Green
Write-Host ""

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   Starting Local Server (Port 3002)" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Server will start in a new window..." -ForegroundColor Yellow
Write-Host "Keep that window open while testing." -ForegroundColor Yellow
Write-Host ""
Write-Host "This window will run the test script." -ForegroundColor Yellow
Write-Host ""
Read-Host "Press Enter to continue"

# Start server in new window
$serverProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", "node server.js" -PassThru
Write-Host "Server started with PID: $($serverProcess.Id)" -ForegroundColor Green

# Wait for server to start
Write-Host ""
Write-Host "Waiting for server to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   Running Tests" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Run test script
node test-local-server.js

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   Testing Complete" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to stop the server and exit..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Stop the server
Write-Host ""
Write-Host "Stopping server..." -ForegroundColor Yellow
try {
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    Write-Host "Server stopped." -ForegroundColor Green
} catch {
    Write-Host "Could not stop server automatically. Please close the server window manually." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Goodbye!" -ForegroundColor Cyan
Start-Sleep -Seconds 2

