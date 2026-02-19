# Run this script as Administrator so other computers can reach the API and frontend.
# Right-click PowerShell -> Run as Administrator, then: .\scripts\allow-dev-ports-firewall.ps1

$rules = @(
  @{ Name = "ROS Dev 3003"; Port = 3003 },
  @{ Name = "ROS API 3001"; Port = 3001 }
)
foreach ($r in $rules) {
  $existing = Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Rule '$($r.Name)' already exists."
  } else {
    New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -LocalPort $r.Port -Protocol TCP -Action Allow
    Write-Host "Added firewall rule: $($r.Name) (port $($r.Port))"
  }
}
Write-Host "Done. Other computers can now reach this PC on ports 3001 and 3003."
