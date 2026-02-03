# Create ros-osc-python-app.zip from ros-osc-python-app folder and put in public/
# Run from project root (or use create-ros-osc-python-app-zip.bat).

$ErrorActionPreference = 'Stop'
$ProjectRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location }
$SourcePath = Join-Path $ProjectRoot 'ros-osc-python-app'
$ZipPath = Join-Path $ProjectRoot 'public\ros-osc-python-app.zip'

if (-not (Test-Path $SourcePath)) {
    Write-Error "Not found: $SourcePath"
}

Compress-Archive -Path $SourcePath -DestinationPath $ZipPath -Force
Write-Host "Created: $ZipPath"
