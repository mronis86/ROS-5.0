# Quick LAN readiness check for the show laptop
$port = 3004
$listening = netstat -an | Select-String "0\.0\.0\.0:$port.*LISTENING"
$rule = netsh advfirewall firewall show rule name="ROS Offline Show 3004" 2>$null

Write-Host ""
Write-Host "ROS Offline Show - LAN check" -ForegroundColor Cyan
Write-Host ""

if ($listening) {
  Write-Host "[OK] Server listening on 0.0.0.0:$port" -ForegroundColor Green
} else {
  Write-Host "[!!] Nothing listening on port $port - start offline-show launcher first" -ForegroundColor Red
}

$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' }
foreach ($ip in $ips) {
  $url = "http://$($ip.IPAddress):$port/health"
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) {
      Write-Host "[OK] $url" -ForegroundColor Green
      Write-Host "     iPad URL: http://$($ip.IPAddress):$port/" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "[!!] $url - $($_.Exception.Message)" -ForegroundColor Red
  }
}

if ($rule -match 'ROS Offline Show') {
  Write-Host "[OK] Firewall rule exists for port $port" -ForegroundColor Green
} else {
  Write-Host "[!!] NO firewall rule - other PCs/iPads will NOT connect" -ForegroundColor Red
  Write-Host "     Right-click: offline-show\launcher\allow-lan-firewall.bat -> Run as administrator" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "On iPad: open Safari and type http://192.168.x.x:3004/ in the address bar." -ForegroundColor Gray
Write-Host "Do NOT use Cursor embedded browser - it cannot load LAN URLs." -ForegroundColor Gray
Write-Host ""
