# Build the site and portable zip, then copy everything into netlify-deploy.
# This folder forces a fresh deploy when uploaded to Netlify via drag-and-drop.
# Run from repository root.

$ErrorActionPreference = 'Stop'
$ProjectRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location) }
$UploadDir = Join-Path $ProjectRoot 'netlify-deploy'
$DistDir = Join-Path $ProjectRoot 'dist'

Write-Host "========== Building portable Electron app =========="
Push-Location (Join-Path $ProjectRoot 'ros-osc-control')
try {
    npm install
    npm run build:portable
} finally {
    Pop-Location
}

Write-Host "========== Creating portable zip (public/ROS-OSC-Control-portable.zip) =========="
$ZipInPublic = Join-Path $ProjectRoot 'public' 'ROS-OSC-Control-portable.zip'
$DistPath = Join-Path $ProjectRoot 'ros-osc-control' 'dist'
if (Test-Path $DistPath) {
    $publicDir = Join-Path $ProjectRoot 'public'
    if (-not (Test-Path $publicDir)) { New-Item -ItemType Directory -Path $publicDir -Force | Out-Null }
    Compress-Archive -Path $DistPath -DestinationPath $ZipInPublic -Force
    Write-Host "Created ROS-OSC-Control-portable.zip from ros-osc-control/dist"
} else {
    Write-Warning "ros-osc-control/dist not found, skipping zip"
}

Write-Host "========== Building Vite app =========="
Push-Location $ProjectRoot
try {
    npm install
    npx vite build
} finally {
    Pop-Location
}

if (-not (Test-Path $DistDir)) {
    Write-Error "dist folder not found after build. Aborting."
    exit 1
}

Write-Host "========== Copying dist to netlify-deploy =========="
if (-not (Test-Path $UploadDir)) {
    New-Item -ItemType Directory -Path $UploadDir -Force | Out-Null
}
Get-ChildItem -Path $DistDir -Force | ForEach-Object {
    $dest = Join-Path $UploadDir $_.Name
    if ($_.PSIsContainer) {
        Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force
    } else {
        Copy-Item -Path $_.FullName -Destination $dest -Force
    }
}

# Ensure portable zip is present in netlify-deploy
$ZipInPublic = Join-Path $ProjectRoot 'public' 'ROS-OSC-Control-portable.zip'
$ZipInDeploy = Join-Path $UploadDir 'ROS-OSC-Control-portable.zip'
if (Test-Path $ZipInPublic) {
    Copy-Item -Path $ZipInPublic -Destination $ZipInDeploy -Force
    Write-Host "Ensured ROS-OSC-Control-portable.zip in netlify-deploy"
} elseif (-not (Test-Path $ZipInDeploy)) {
    Write-Warning "ROS-OSC-Control-portable.zip not found - deploy will not include the portable app"
}

# Write build-info.txt to force unique content and bust caches
$BuildInfo = @"
build_date=$(Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
build_id=$([Guid]::NewGuid().ToString("N"))
"@
Set-Content -Path (Join-Path $UploadDir 'build-info.txt') -Value $BuildInfo -Encoding UTF8
Write-Host "Wrote build-info.txt (forces fresh deploy)"

# SPA redirects
$RedirectsContent = @"
# SPA: all routes to index.html (Netlify static deploy)
/*    /index.html   200
"@
Set-Content -Path (Join-Path $UploadDir '_redirects') -Value $RedirectsContent -Encoding UTF8

# netlify.toml with cache-busting headers to force fresh content
$TomlContent = @"
# Netlify config for UPLOAD DEPLOY (netlify-deploy folder)
# Upload this folder to Netlify - each deploy is fresh (build-info.txt + no-cache headers)

[build]
  publish = "."

# SPA: all routes -> index.html
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

# Security and cache-busting headers (force revalidate, no stale content)
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-XSS-Protection = "1; mode=block"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"

[[headers]]
  for = "/index.html"
  [headers.values]
    Cache-Control = "no-cache, no-store, must-revalidate"

[[headers]]
  for = "/build-info.txt"
  [headers.values]
    Cache-Control = "no-cache, no-store, must-revalidate"

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.html"
  [headers.values]
    Cache-Control = "no-cache, no-store, must-revalidate"
"@
Set-Content -Path (Join-Path $UploadDir 'netlify.toml') -Value $TomlContent -Encoding UTF8

Write-Host "========== Done =========="
Write-Host "Upload the folder: $UploadDir"
Write-Host "Contents: index.html, assets/, ROS-OSC-Control-portable.zip, build-info.txt, _redirects, netlify.toml"
Write-Host "In Netlify: Deploys -> Drag and drop this folder."