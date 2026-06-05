param(
  [string]$Url = 'http://127.0.0.1:3004/health',
  [int]$TimeoutSec = 90
)

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { exit 0 }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
Write-Error "Server did not respond at $Url within ${TimeoutSec}s"
exit 1
