# Build the site and portable zip, then copy everything into netlify-upload
# so you can upload that folder to Netlify (drag-and-drop).
# Run from repository root.

$ErrorActionPreference = 'Stop'
$ProjectRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location) }
$UploadDir = Join-Path $ProjectRoot 'netlify-upload'
$DistDir = Join-Path $ProjectRoot 'dist'

Write-Host "========== Building portable Electron app =========="
Push-Location (Join-Path $ProjectRoot 'ros-osc-control')
try {
    npm ci
    npm run build:portable
} finally {
    Pop-Location
}

Write-Host "========== Building Vite app (prebuild zips portable to public) =========="
Push-Location $ProjectRoot
try {
    npm ci
    npm run build
} finally {
    Pop-Location
}

if (-not (Test-Path $DistDir)) {
    Write-Error "dist folder not found after build. Aborting."
    exit 1
}

Write-Host "========== Copying dist to netlify-upload =========="
if (-not (Test-Path $UploadDir)) {
    New-Item -ItemType Directory -Path $UploadDir -Force | Out-Null
}
# Copy dist contents into netlify-upload (overwrite)
Get-ChildItem -Path $DistDir -Force | ForEach-Object {
    $dest = Join-Path $UploadDir $_.Name
    if ($_.PSIsContainer) {
        Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force
    } else {
        Copy-Item -Path $_.FullName -Destination $dest -Force
    }
}

# Ensure _redirects and netlify.toml are present (overwrite from templates)
$RedirectsContent = @"
# SPA: all routes to index.html (Netlify static deploy)
/*    /index.html   200
"@
Set-Content -Path (Join-Path $UploadDir '_redirects') -Value $RedirectsContent -Encoding UTF8

$TomlContent = @"
# Netlify config for UPLOAD DEPLOY (this folder is the site)
# Use when you upload this folder to Netlify. No build on Netlify.

[build]
  publish = "."

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-XSS-Protection = "1; mode=block"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.html"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"
"@
Set-Content -Path (Join-Path $UploadDir 'netlify.toml') -Value $TomlContent -Encoding UTF8

Write-Host "========== Done =========="
Write-Host "Upload the folder: $UploadDir"
Write-Host "It contains: index.html, assets/, ROS-OSC-Control-portable.zip, _redirects, netlify.toml"
Write-Host "In Netlify: Deploys -> Drag and drop this folder (or deploy manually)."
