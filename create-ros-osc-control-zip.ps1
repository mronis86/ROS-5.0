# Create ROS-OSC-Control-portable.zip from ros-osc-control\dist
# Run from project root (or use Create-ros-osc-control-zip.bat).

$ErrorActionPreference = 'Stop'
$ProjectRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location }
$DistPath = Join-Path $ProjectRoot 'ros-osc-control\dist'
$ZipPath = Join-Path $ProjectRoot 'public\ROS-OSC-Control-portable.zip'

if (-not (Test-Path $DistPath)) {
    Write-Error "Not found: $DistPath. Run build-standalone.bat in ros-osc-control first."
}

# Zip the entire dist folder (so extract gives a 'dist' folder with the exe inside)
Compress-Archive -Path $DistPath -DestinationPath $ZipPath -Force
Write-Host "Created: $ZipPath"
