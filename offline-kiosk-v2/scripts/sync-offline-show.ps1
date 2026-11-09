# Refresh bundled Offline Show from the sibling ../offline-show (leave sibling untouched).
$ErrorActionPreference = 'Stop'
$kioskRoot = Split-Path -Parent $PSScriptRoot
$src = Join-Path (Split-Path -Parent $kioskRoot) 'offline-show'
$dst = Join-Path $kioskRoot 'engines\offline-show'

if (-not (Test-Path (Join-Path $src 'server\server.js'))) {
  throw "Source Offline Show not found: $src"
}

New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
Write-Host "Copying $src -> $dst (skipping node_modules/data)..."
robocopy $src $dst /E /XD node_modules data .git dist ui\dist /XF *.db *.db-wal *.db-shm /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
# robocopy 0-7 = success-ish
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit $LASTEXITCODE" }

Write-Host "npm install in bundled engine..."
Push-Location $dst
try {
  npm install
} finally {
  Pop-Location
}

Write-Host "Done. Kiosk will use: $dst"
