Write-Host "🚀 Starting Local Run of Show Server..." -ForegroundColor Green
Write-Host ""

# Change to the Electron-React-Backup directory
Set-Location ".\Electron-React-Backup"

Write-Host "📦 Installing dependencies if needed..." -ForegroundColor Yellow
npm install

Write-Host ""
Write-Host "🌐 Starting React development server on port 3003..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm start" -WindowStyle Normal

Write-Host ""
Write-Host "⏳ Waiting for React server to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

Write-Host ""
Write-Host "🎵 Starting OSC service..." -ForegroundColor Magenta
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node standalone-osc-server.js" -WindowStyle Normal

Write-Host ""
Write-Host "✅ Local servers started!" -ForegroundColor Green
Write-Host ""
Write-Host "🌐 React App: http://localhost:3003" -ForegroundColor Cyan
Write-Host "🎵 OSC Server: Port 57121" -ForegroundColor Magenta
Write-Host ""

$response = Read-Host "Press Enter to open the Run of Show in your browser, or 'q' to quit"
if ($response -ne 'q') {
    Start-Process "http://localhost:3003"
    Write-Host ""
    Write-Host "🎉 Run of Show is now running locally!" -ForegroundColor Green
    Write-Host ""
    Write-Host "To stop the servers, close the PowerShell windows that opened." -ForegroundColor Yellow
}

Read-Host "Press Enter to exit"
