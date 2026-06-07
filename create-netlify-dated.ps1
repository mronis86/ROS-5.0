# Build site and portable zip, then populate netlify-{date}-V2
# Run from repository root.

$ErrorActionPreference = 'Stop'
$ProjectRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location) }
$DateStr = Get-Date -Format "yyyy-MM-dd"
$UploadDir = Join-Path $ProjectRoot "netlify-$DateStr-V2"
$DistDir = Join-Path $ProjectRoot 'dist'
$OscDist = Join-Path (Join-Path $ProjectRoot 'ros-osc-control') 'dist'
$publicDir = Join-Path $ProjectRoot 'public'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

Write-Host "========== Building portable Electron app =========="
Push-Location (Join-Path $ProjectRoot 'ros-osc-control')
try {
    npm install 2>$null
    npm run build:portable
} catch {
    Write-Warning "Portable Electron build failed or skipped: $_"
} finally {
    Pop-Location
}

Write-Host "========== Creating portable zip from ros-osc-control/dist =========="
$ZipPath = Join-Path $publicDir 'ROS-OSC-Control-portable.zip'
$WinUnpacked = Join-Path $OscDist 'win-unpacked'
if (-not (Test-Path $publicDir)) { New-Item -ItemType Directory -Path $publicDir -Force | Out-Null }
if (Test-Path $OscDist) {
    try {
        Compress-Archive -Path $OscDist -DestinationPath $ZipPath -Force
        Write-Host "Created ROS-OSC-Control-portable.zip from dist"
    } catch {
        if (Test-Path $WinUnpacked) {
            Compress-Archive -Path $WinUnpacked -DestinationPath $ZipPath -Force
            Write-Host "Created ROS-OSC-Control-portable.zip from win-unpacked (exe was in use)"
        } else {
            Write-Warning "Could not create zip - dist or win-unpacked not found"
        }
    }
} else {
    Write-Warning "ros-osc-control/dist not found. Build it first: cd ros-osc-control && npm run build:portable"
}

Write-Host "========== Building Vite app (prebuild + companion zips) =========="
Push-Location $ProjectRoot
try {
    npm install 2>$null
    npm run build
    node scripts/zip-companion-module-full.js
    node scripts/zip-companion-module-resolume-full.js
} finally {
    Pop-Location
}

if (-not (Test-Path $DistDir)) {
    Write-Error "dist folder not found after build."
    exit 1
}

$distIndexHtml = Join-Path $DistDir 'index.html'
$distAssetsDir = Join-Path $DistDir 'assets'
if (-not (Test-Path $distIndexHtml)) {
    Write-Error "dist/index.html missing - Vite build did not complete."
    exit 1
}
$assetFiles = @(Get-ChildItem -Path $distAssetsDir -File -ErrorAction SilentlyContinue)
if ($assetFiles.Count -lt 2) {
    Write-Error "dist/assets is missing or incomplete (expected Vite CSS + JS). Re-run npm run build before deploying."
    exit 1
}
Write-Host ("Verified dist/assets: {0} files (e.g. {1})" -f $assetFiles.Count, $assetFiles[0].Name)

Write-Host "========== Copying to $UploadDir =========="
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

function Copy-DeployZip($fileName) {
    $src = Join-Path $publicDir $fileName
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination (Join-Path $UploadDir $fileName) -Force
        Write-Host "Added $fileName for OSC modal download"
    }
}

Copy-DeployZip 'ROS-OSC-Control-portable.zip'
Copy-DeployZip 'companion-module-runofshow-full.zip'
Copy-DeployZip 'companion-module-runofshow-resolume-full.zip'
Copy-DeployZip 'offline-show.zip'

$BuildInfo = @"
build_date=$(Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
build_id=$([Guid]::NewGuid().ToString("N"))
deploy_folder=netlify-$DateStr-V2
"@
[System.IO.File]::WriteAllText((Join-Path $UploadDir 'build-info.txt'), $BuildInfo, $utf8NoBom)
Write-Host "Wrote build-info.txt (forces fresh deploy)"

# Zip downloads must be served directly before SPA fallback
$RedirectsContent = @"
/companion-module-runofshow.zip                 /companion-module-runofshow.zip                 200
/companion-module-runofshow-full.zip            /companion-module-runofshow-full.zip            200
/companion-module-runofshow-resolume-full.zip   /companion-module-runofshow-resolume-full.zip   200
/ros-osc-python-app.zip                         /ros-osc-python-app.zip                         200
/ROS-OSC-Control-portable.zip                   /ROS-OSC-Control-portable.zip                   200
/electron-osc-app.zip                           /electron-osc-app.zip                           200
/offline-show.zip                               /offline-show.zip                               200

/*    /index.html   200
"@
[System.IO.File]::WriteAllText((Join-Path $UploadDir '_redirects'), $RedirectsContent, $utf8NoBom)

$TomlContent = @"
# Netlify config for UPLOAD DEPLOY (netlify-$DateStr-V2)
# Upload this folder to Netlify - dated deploy forces fresh content

[build]
  publish = "."

[[redirects]]
  from = "/companion-module-runofshow.zip"
  to = "/companion-module-runofshow.zip"
  status = 200
  force = true

[[redirects]]
  from = "/companion-module-runofshow-full.zip"
  to = "/companion-module-runofshow-full.zip"
  status = 200
  force = true

[[redirects]]
  from = "/companion-module-runofshow-resolume-full.zip"
  to = "/companion-module-runofshow-resolume-full.zip"
  status = 200
  force = true

[[redirects]]
  from = "/ros-osc-python-app.zip"
  to = "/ros-osc-python-app.zip"
  status = 200
  force = true

[[redirects]]
  from = "/ROS-OSC-Control-portable.zip"
  to = "/ROS-OSC-Control-portable.zip"
  status = 200
  force = true

[[redirects]]
  from = "/electron-osc-app.zip"
  to = "/electron-osc-app.zip"
  status = 200
  force = true

[[redirects]]
  from = "/offline-show.zip"
  to = "/offline-show.zip"
  status = 200
  force = true

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
[System.IO.File]::WriteAllText((Join-Path $UploadDir 'netlify.toml'), $TomlContent, $utf8NoBom)

$uploadAssets = @(Get-ChildItem -Path (Join-Path $UploadDir 'assets') -File -ErrorAction SilentlyContinue)
if ($uploadAssets.Count -lt 2) {
    Write-Error "Upload folder is missing dist/assets - deploy would break CSS/JS loading. Aborting."
    exit 1
}
Write-Host ("Verified upload assets: {0} files" -f $uploadAssets.Count)

Write-Host "========== Done =========="
Write-Host "Upload folder: $UploadDir"
Write-Host "Contains: site + OSC zips + build-info.txt + _redirects + netlify.toml"
