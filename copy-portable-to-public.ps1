# Copy built portable exe to public/portable-electron so local dev and Netlify build can serve it.
# Run from project root. Build the portable first: cd ros-osc-control && npm run build:portable

$ErrorActionPreference = 'Stop'
$ProjectRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location) }
$Src = Join-Path $ProjectRoot 'ros-osc-control\dist\ROS-OSC-Control-1.0.0-portable.exe'
$DestDir = Join-Path $ProjectRoot 'public\portable-electron'
$Dest = Join-Path $DestDir 'ROS-OSC-Control-1.0.0-portable.exe'

if (-not (Test-Path $Src)) {
    Write-Host "Portable exe not found. Build it first:"
    Write-Host "  cd ros-osc-control"
    Write-Host "  npm run build:portable"
    exit 1
}

if (-not (Test-Path $DestDir)) {
    New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
}
Copy-Item -Path $Src -Destination $Dest -Force
Write-Host "Copied portable exe to public/portable-electron. Local and Netlify can now serve it."
Write-Host "  $Dest"
