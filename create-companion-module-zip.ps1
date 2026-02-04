# Create companion-module-runofshow.zip for Bitfocus Companion (excludes node_modules)
# Run from project root (or use create-companion-module-zip.bat).
# Output: public/companion-module-runofshow.zip

$ErrorActionPreference = 'Stop'
$ProjectRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location }
$SourcePath = Join-Path $ProjectRoot 'companion-module-runofshow'
$ZipPath = Join-Path $ProjectRoot 'public\companion-module-runofshow.zip'

if (-not (Test-Path $SourcePath)) {
    Write-Error "Not found: $SourcePath"
}

$tempDir = Join-Path $env:TEMP "companion-module-runofshow-build"
if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }
$destDir = Join-Path $tempDir "companion-module-runofshow"
New-Item -ItemType Directory -Path $destDir -Force | Out-Null

# Copy excluding node_modules and .git (keeps zip small)
robocopy $SourcePath $destDir /E /XD node_modules .git /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null

# Ensure public exists
$publicDir = Join-Path $ProjectRoot 'public'
if (-not (Test-Path $publicDir)) { New-Item -ItemType Directory -Path $publicDir -Force | Out-Null }

Compress-Archive -Path $destDir -DestinationPath $ZipPath -Force
Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
Write-Host "Created: $ZipPath"
