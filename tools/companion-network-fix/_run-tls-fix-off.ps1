$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_lib.ps1"

try {
  $exe = Find-CompanionExe
  if (-not $exe) {
    Write-Host ""
    Write-Host "Could not find Companion.exe automatically."
    Write-Host "Set COMPANION_EXE to the full path, then rerun."
    exit 2
  }

  Write-Host "Found Companion: $exe"
  Start-CompanionProcess -ExePath $exe -ExtraEnv @{}
  Write-Host ""
  Write-Host "Companion started with TLS workaround OFF (normal)."
  exit 0
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
