$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_lib.ps1"

try {
  Download-ApiCertChain | Out-Null
  Write-Host ""
  Write-Host "Cert download finished. See .\certs\"
  exit 0
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
