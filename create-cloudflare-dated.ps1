# Build a Cloudflare Pages upload folder: cloudflare-{date}-V2
# Same Vite dist as Netlify, but excludes files over 25 MiB (Pages limit).
# Run from repository root:
#   powershell -NoProfile -ExecutionPolicy Bypass -File create-cloudflare-dated.ps1
#
# Deploy: Cloudflare Dashboard > Workers and Pages > Create > Upload assets
#         Drag the cloudflare-YYYY-MM-DD-V2 folder.

$ErrorActionPreference = 'Stop'
$ProjectRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$DateStr = Get-Date -Format 'yyyy-MM-dd'
$UploadDir = Join-Path $ProjectRoot "cloudflare-$DateStr-V2"
$DistDir = Join-Path $ProjectRoot 'dist'
$publicDir = Join-Path $ProjectRoot 'public'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$MaxFileBytes = 25 * 1024 * 1024

Write-Host '========== Cloudflare Pages deploy folder =========='

if (-not (Test-Path (Join-Path $DistDir 'index.html'))) {
    Write-Host 'dist/ missing - running npm run build...'
    Push-Location $ProjectRoot
    try { npm run build } finally { Pop-Location }
}

if (-not (Test-Path (Join-Path $DistDir 'index.html'))) {
    Write-Error 'dist/index.html still missing after build.'
    exit 1
}

if (Test-Path $UploadDir) {
    Remove-Item $UploadDir -Recurse -Force
}
New-Item -ItemType Directory -Path $UploadDir -Force | Out-Null

Write-Host "Copying dist -> $UploadDir"
Copy-Item -Path (Join-Path $DistDir '*') -Destination $UploadDir -Recurse -Force

# Strip source/dev trees Vite copies from public/ (these blow past upload limits)
$StripDirs = @('electron-osc-app', 'portable-electron', 'node_modules', '.git')
foreach ($dirName in $StripDirs) {
    Get-ChildItem $UploadDir -Directory -Recurse -Filter $dirName -ErrorAction SilentlyContinue |
        ForEach-Object {
            Write-Host "Removing $($_.FullName.Substring($UploadDir.Length + 1))"
            Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
}

$Skipped = New-Object System.Collections.Generic.List[string]

# Drop any single file over Pages' 25 MiB limit (including ones copied from dist)
Get-ChildItem $UploadDir -File -Recurse | Where-Object { $_.Length -gt $MaxFileBytes } | ForEach-Object {
    $rel = $_.FullName.Substring($UploadDir.Length + 1)
    [void]$Skipped.Add(('{0} ({1:N1} MB > 25 MiB)' -f $rel, ($_.Length / 1MB)))
    Remove-Item $_.FullName -Force
    Write-Host "Removed oversized: $rel"
}

$OptionalZips = @(
    'companion-module-runofshow.zip',
    'companion-module-runofshow-full.zip',
    'companion-module-runofshow-resolume-full.zip',
    'companion-module-runofshow-mitti-full.zip',
    'offline-show.zip',
    'ros-led-spout.zip',
    'ros-osc-python-app.zip',
    'electron-osc-app.zip'
)

foreach ($name in $OptionalZips) {
    $src = Join-Path $publicDir $name
    if (-not (Test-Path $src)) { continue }
    $len = (Get-Item $src).Length
    if ($len -gt $MaxFileBytes) {
        if (-not ($Skipped | Where-Object { $_ -like "$name*" })) {
            [void]$Skipped.Add(('{0} ({1:N1} MB > 25 MiB)' -f $name, ($len / 1MB)))
        }
        continue
    }
    Copy-Item $src (Join-Path $UploadDir $name) -Force
    Write-Host ('Added {0} ({1:N1} MB)' -f $name, ($len / 1MB))
}

foreach ($big in @('ROS-OSC-Control-portable.zip', 'ros-vmix-datasource-bridge.zip')) {
    $src = Join-Path $publicDir $big
    if (Test-Path $src) {
        $already = $Skipped | Where-Object { $_ -like "$big*" }
        if (-not $already) {
            [void]$Skipped.Add(('{0} ({1:N1} MB - host on Netlify or R2)' -f $big, ((Get-Item $src).Length / 1MB)))
        }
    }
}

$Redirects = @'
/companion-module-runofshow.zip                 /companion-module-runofshow.zip                 200
/companion-module-runofshow-full.zip            /companion-module-runofshow-full.zip            200
/companion-module-runofshow-resolume-full.zip   /companion-module-runofshow-resolume-full.zip   200
/companion-module-runofshow-mitti-full.zip      /companion-module-runofshow-mitti-full.zip      200
/offline-show.zip                               /offline-show.zip                               200
/ros-led-spout.zip                              /ros-led-spout.zip                              200
/ros-osc-python-app.zip                         /ros-osc-python-app.zip                         200
/electron-osc-app.zip                           /electron-osc-app.zip                           200

/*    /index.html   200
'@
[System.IO.File]::WriteAllText((Join-Path $UploadDir '_redirects'), $Redirects, $utf8NoBom)

$Headers = @'
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-XSS-Protection: 1; mode=block

/index.html
  Cache-Control: no-cache, no-store, must-revalidate

/build-info.txt
  Cache-Control: no-cache, no-store, must-revalidate

/assets/*
  Cache-Control: public, max-age=31536000, immutable
'@
[System.IO.File]::WriteAllText((Join-Path $UploadDir '_headers'), $Headers, $utf8NoBom)

$BuildInfo = @(
    "build_date=$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')"
    "build_id=$([Guid]::NewGuid().ToString('N'))"
    "deploy_folder=cloudflare-$DateStr-V2"
    'host=cloudflare-pages'
) -join "`n"
[System.IO.File]::WriteAllText((Join-Path $UploadDir 'build-info.txt'), $BuildInfo, $utf8NoBom)

$SkipLines = if ($Skipped.Count -gt 0) {
    ($Skipped | ForEach-Object { "  - $_" }) -join "`n"
} else {
    '  (none)'
}

$DeployLines = @(
    "Run of Show - Cloudflare Pages deploy ($DateStr)"
    ''
    'HOW TO UPLOAD (recommended)'
    '1. Cloudflare Dashboard > Workers and Pages > Create > Pages > Upload assets'
    "2. Drag this folder: cloudflare-$DateStr-V2"
    '3. After deploy, copy your https://YOUR-PROJECT.pages.dev URL'
    ''
    'GIT CONNECT (alternative) - use Pages, NOT Workers + wrangler'
    '- Framework preset: Vite (or None)'
    '- Build command: npm run build'
    '- Build output directory: dist'
    '- Deploy command: LEAVE EMPTY (do not use npx wrangler deploy)'
    '- Wrangler auto-setup breaks this repo (injects @cloudflare/vite-plugin)'
    ''
    'RAILWAY (required for sockets/API)'
    '- Redeploy API so *.pages.dev and *.netlify.app Socket.IO origins are allowed'
    '- Or set Railway env SOCKET_CORS_ORIGINS=https://YOUR-PROJECT.pages.dev'
    '- Neon Auth: add the same origin to trusted/redirect URLs if needed'
    ''
    'BOTH NETLIFY AND CLOUDFLARE'
    '- netlify-YYYY-MM-DD-V2     -> Netlify drag-drop'
    '- cloudflare-YYYY-MM-DD-V2  -> Cloudflare Pages upload'
    '- Graphics / lower-thirds: use Railway or Cached (not .netlify/functions)'
    ''
    'FILES SKIPPED (Cloudflare Pages max 25 MiB per file)'
    $SkipLines
    ''
    'Serve large zips from Netlify, Railway, or Cloudflare R2 if needed.'
)
[System.IO.File]::WriteAllText((Join-Path $UploadDir 'DEPLOY.txt'), ($DeployLines -join "`n"), $utf8NoBom)

$assets = @(Get-ChildItem (Join-Path $UploadDir 'assets') -File -ErrorAction SilentlyContinue)
if ($assets.Count -lt 2) {
    Write-Error 'Upload folder missing assets - aborting.'
    exit 1
}

Write-Host '========== Done =========='
Write-Host "Upload folder: $UploadDir"
Write-Host ("Assets: {0}" -f $assets.Count)
if ($Skipped.Count -gt 0) {
    Write-Host 'Skipped large files:'
    $Skipped | ForEach-Object { Write-Host "  $_" }
}
Write-Host 'See DEPLOY.txt in the folder for steps.'
