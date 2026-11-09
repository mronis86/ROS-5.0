# Bundle Sinor WebLinked runtime into engines/weblinked from the Desktop WebLinked-SDI build.
# Leaves C:\Users\audre\OneDrive\Desktop\WebLinked-SDI untouched as the upstream reference.
$ErrorActionPreference = 'Stop'
$kioskRoot = Split-Path -Parent $PSScriptRoot
$dst = Join-Path $kioskRoot 'engines\weblinked'

$candidates = @(
  (Join-Path $env:USERPROFILE 'OneDrive\Desktop\WebLinked-SDI\build\Release'),
  (Join-Path $env:USERPROFILE 'Desktop\WebLinked-SDI\build\Release'),
  'C:\Program Files\WebLinked'
)

$src = $null
foreach ($c in $candidates) {
  if ((Test-Path (Join-Path $c 'sinor-weblinked.exe')) -or (Test-Path (Join-Path $c 'weblinked.exe'))) {
    $src = $c
    break
  }
}

if (-not $src) {
  throw "No WebLinked runtime found. Build WebLinked-SDI (build\Release) or install WebLinked."
}

New-Item -ItemType Directory -Force -Path $dst | Out-Null
Write-Host "Copying runtime from:`n  $src`n-> $dst"

# Runtime payload only (skip tests / import libs / PDBs).
robocopy $src $dst /E `
  /XF weblinked_tests.exe *.lib *.pdb Uninstall.exe `
  /XD CMakeFiles `
  /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit $LASTEXITCODE" }

# Prefer Sinor binary name for the kiosk launcher.
$sinor = Join-Path $dst 'sinor-weblinked.exe'
$stock = Join-Path $dst 'weblinked.exe'
if (-not (Test-Path $sinor) -and (Test-Path $stock)) {
  Copy-Item $stock $sinor -Force
}

# Provenance note (source tree stays on Desktop).
@"
Bundled WebLinked runtime for Offline Kiosk V2.
Upstream reference (do not delete): WebLinked-SDI on the Desktop.
Synced from: $src
Synced at: $(Get-Date -Format o)
"@ | Set-Content -Path (Join-Path $dst 'BUNDLE.txt') -Encoding UTF8

Write-Host "Done. Primary exe: $(if (Test-Path $sinor) { $sinor } else { $stock })"
