# Build site and portable zip, then populate netlify-{date}-V2
# Run from repository root.

$ErrorActionPreference = 'Stop'
$ProjectRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location) }
$DateStr = Get-Date -Format "yyyy-MM-dd"
$UploadDir = Join-Path $ProjectRoot "netlify-$DateStr-V2"
$DistDir = Join-Path $ProjectRoot 'dist'
$OscDist = Join-Path (Join-Path $ProjectRoot 'ros-osc-control') 'dist'

Write-Host "========== Creating portable zip from ros-osc-control/dist =========="
$ZipPath = Join-Path (Join-Path $ProjectRoot 'public') 'ROS-OSC-Control-portable.zip'
$WinUnpacked = Join-Path $OscDist 'win-unpacked'
$publicDir = Join-Path $ProjectRoot 'public'
if (-not (Test-Path $publicDir)) { New-Item -ItemType Directory -Path $publicDir -Force | Out-Null }
if (Test-Path $OscDist) {
    try {
        Compress-Archive -Path $OscDist -DestinationPath $ZipPath -Force
        Write-Host "Created ROS-OSC-Control-portable.zip from dist"
    } catch {
        # Portable exe may be locked; zip win-unpacked only (contains runnable app)
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

Write-Host "========== Building Vite app (prebuild creates companion + python zips) =========="
Push-Location $ProjectRoot
try {
    npm install 2>$null
    npm run build
} finally {
    Pop-Location
}

if (-not (Test-Path $DistDir)) {
    Write-Error "dist folder not found after build."
    exit 1
}

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

# Ensure portable zip is in the deploy folder (for OSC modal download)
if (Test-Path $ZipPath) {
    Copy-Item -Path $ZipPath -Destination (Join-Path $UploadDir 'ROS-OSC-Control-portable.zip') -Force
    Write-Host "Added ROS-OSC-Control-portable.zip for OSC modal download"
}
# Companion full zip (from public, Vite copies to dist; ensure redirect exists)
$CompanionFullZip = Join-Path $publicDir 'companion-module-runofshow-full.zip'
if (Test-Path $CompanionFullZip) {
    Copy-Item -Path $CompanionFullZip -Destination (Join-Path $UploadDir 'companion-module-runofshow-full.zip') -Force
    Write-Host "Added companion-module-runofshow-full.zip for OSC modal download"
}

# Netlify config (zip downloads must be served directly before SPA fallback)
$RedirectsContent = @"
/companion-module-runofshow.zip       /companion-module-runofshow.zip       200
/companion-module-runofshow-full.zip /companion-module-runofshow-full.zip 200
/ros-osc-python-app.zip              /ros-osc-python-app.zip              200
/ROS-OSC-Control-portable.zip        /ROS-OSC-Control-portable.zip        200
/electron-osc-app.zip                /electron-osc-app.zip                200

/*    /index.html   200
"@
Set-Content -Path (Join-Path $UploadDir '_redirects') -Value $RedirectsContent -Encoding UTF8

$TomlContent = @"
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
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-XSS-Protection = "1; mode=block"
    X-Content-Type-Options = "nosniff"

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
"@
# UTF-8 without BOM (Netlify fails on BOM)
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $UploadDir 'netlify.toml'), $TomlContent, $utf8NoBom)

Write-Host "========== Done =========="
Write-Host "Upload folder: $UploadDir"
Write-Host "Contains: site + all OSC zips (portable, Python, Companion)"
