$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_lib.ps1"

try {
  $exe = Find-CompanionExe
  if (-not $exe) {
    Write-Host ""
    Write-Host "Could not find Companion.exe automatically."
    Write-Host "Set a permanent user env var COMPANION_EXE to the full path, e.g.:"
    Write-Host '  setx COMPANION_EXE "C:\Program Files\Companion\Companion.exe"'
    Write-Host "Or edit this folder's scripts after installing Companion."
    exit 2
  }

  Write-Host "Found Companion: $exe"
  $pem = Download-ApiCertChain

  Start-CompanionProcess -ExePath $exe -ExtraEnv @{
    NODE_EXTRA_CA_CERTS = $pem
    NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }

  Write-Host ""
  Write-Host "Companion started with TLS workaround ON."
  Write-Host "  NODE_EXTRA_CA_CERTS=$pem"
  Write-Host "  NODE_TLS_REJECT_UNAUTHORIZED=0"
  exit 0
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
