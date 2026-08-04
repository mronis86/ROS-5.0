# Build a Cloudflare Pages upload folder: cloudflare-{date}-V2
# - Excludes files over 25 MiB (Pages limit)
# - Large download zips redirect to Netlify (free; no R2 / payment method)
#
# Run from repository root:
#   powershell -NoProfile -ExecutionPolicy Bypass -File create-cloudflare-dated.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File create-cloudflare-dated.ps1 -NetlifyDownloadsBase https://ros1615.netlify.app
#
# Deploy Pages:
#   npx wrangler pages deploy cloudflare-YYYY-MM-DD-V2 --project-name=ros1615 --commit-dirty=true

param(
    [string]$NetlifyDownloadsBase = 'https://ros1615.netlify.app'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$DateStr = Get-Date -Format 'yyyy-MM-dd'
$UploadDir = Join-Path $ProjectRoot "cloudflare-$DateStr-V2"
$DistDir = Join-Path $ProjectRoot 'dist'
$publicDir = Join-Path $ProjectRoot 'public'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$MaxFileBytes = 25 * 1024 * 1024
$NetlifyBase = $NetlifyDownloadsBase.TrimEnd('/')
$LargeZips = @('ROS-OSC-Control-portable.zip', 'ros-vmix-datasource-bridge.zip')
$UnusedDeployZips = @(
    'OSC_GUI_App_Enhanced.zip',
    'OSC_GUI_App_Enhanced_Updated.zip',
    'OSC_WebSocket_App.zip',
    'osc-gui-app.zip',
    'osc-server-package.zip',
    'LiveGraphicsGenerator-Python.zip',
    'ROS-Local-Server.zip',
    'ROS-Local-Server-Python.zip',
    'companion-module-runofshow.zip'
)

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

foreach ($dirName in @('electron-osc-app', 'portable-electron', 'node_modules', '.git')) {
    Get-ChildItem $UploadDir -Directory -Recurse -Filter $dirName -ErrorAction SilentlyContinue |
        ForEach-Object {
            Write-Host "Removing $($_.FullName.Substring($UploadDir.Length + 1))"
            Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
}

foreach ($name in $UnusedDeployZips) {
    $p = Join-Path $UploadDir $name
    if (Test-Path $p) {
        Remove-Item $p -Force
        Write-Host "Removed unused zip: $name"
    }
}

$Skipped = New-Object System.Collections.Generic.List[string]
$NetlifyHosted = New-Object System.Collections.Generic.List[string]

Get-ChildItem $UploadDir -File -Recurse | Where-Object { $_.Length -gt $MaxFileBytes } | ForEach-Object {
    $rel = $_.FullName.Substring($UploadDir.Length + 1)
    [void]$Skipped.Add(('{0} ({1:N1} MB > 25 MiB)' -f $rel, ($_.Length / 1MB)))
    Remove-Item $_.FullName -Force
    Write-Host "Removed oversized: $rel"
}

$OptionalZips = @(
    'companion-module-runofshow-full.zip',
    'companion-module-runofshow-resolume-full.zip',
    'companion-module-runofshow-mitti-full.zip',
    'offline-show.zip',
    'ros-led-spout.zip',
    'ros-osc-python-app.zip',
    'electron-osc-app.zip',
    'OptimizedGraphicsGenerator-Python.zip',
    'ROS-Local-Server-NodeJS.zip'
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

foreach ($big in $LargeZips) {
    $src = Join-Path $publicDir $big
    if (-not (Test-Path $src)) { continue }
    $mb = (Get-Item $src).Length / 1MB
    [void]$NetlifyHosted.Add(('{0} ({1:N1} MB -> {2}/{0})' -f $big, $mb, $NetlifyBase))
    Write-Host ("Large zip redirect: /{0} -> {1}/{0}" -f $big, $NetlifyBase)
}

$redirectLines = New-Object System.Collections.Generic.List[string]
[void]$redirectLines.Add('/companion-module-runofshow-full.zip            /companion-module-runofshow-full.zip            200')
[void]$redirectLines.Add('/companion-module-runofshow-resolume-full.zip   /companion-module-runofshow-resolume-full.zip   200')
[void]$redirectLines.Add('/companion-module-runofshow-mitti-full.zip      /companion-module-runofshow-mitti-full.zip      200')
[void]$redirectLines.Add('/offline-show.zip                               /offline-show.zip                               200')
[void]$redirectLines.Add('/ros-led-spout.zip                              /ros-led-spout.zip                              200')
[void]$redirectLines.Add('/ros-osc-python-app.zip                         /ros-osc-python-app.zip                         200')
[void]$redirectLines.Add('/electron-osc-app.zip                           /electron-osc-app.zip                           200')
[void]$redirectLines.Add('/OptimizedGraphicsGenerator-Python.zip         /OptimizedGraphicsGenerator-Python.zip         200')
[void]$redirectLines.Add('/ROS-Local-Server-NodeJS.zip                    /ROS-Local-Server-NodeJS.zip                    200')

foreach ($big in $LargeZips) {
    # 302 to Netlify so CF Pages stays under 25 MiB; app links stay /filename.zip
    [void]$redirectLines.Add(('/{0}  {1}/{0}  302' -f $big, $NetlifyBase))
}

[void]$redirectLines.Add('')
[void]$redirectLines.Add('/*    /index.html   200')
[System.IO.File]::WriteAllText((Join-Path $UploadDir '_redirects'), ($redirectLines -join "`n"), $utf8NoBom)

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
    "large_zip_host=netlify"
    "netlify_downloads_base=$NetlifyBase"
) -join "`n"
[System.IO.File]::WriteAllText((Join-Path $UploadDir 'build-info.txt'), $BuildInfo, $utf8NoBom)

$SkipLines = if ($Skipped.Count -gt 0) {
    ($Skipped | ForEach-Object { "  - $_" }) -join "`n"
} else {
    '  (none)'
}
$NetlifyLines = if ($NetlifyHosted.Count -gt 0) {
    ($NetlifyHosted | ForEach-Object { "  - $_" }) -join "`n"
} else {
    '  (none)'
}

$DeployLines = @(
    "Run of Show - Cloudflare Pages deploy ($DateStr)"
    ''
    'HOW TO DEPLOY'
    "1. npx wrangler pages deploy cloudflare-$DateStr-V2 --project-name=ros1615 --commit-dirty=true"
    '   (or drag-drop this folder in Pages > Upload assets)'
    ''
    'LARGE ZIPS (hosted on Netlify - free, no R2)'
    "- Base: $NetlifyBase"
    $NetlifyLines
    '- App download links stay /filename.zip; _redirects 302 to Netlify'
    '- Keep those zips on the Netlify site (drag netlify-*-V2 or CLI deploy)'
    ''
    'RAILWAY / NEON'
    '- Socket.IO: *.pages.dev allowed after API redeploy with CORS change'
    '- Neon Auth: add https://ros1615.pages.dev to trusted domains'
    ''
    'REMOVED FROM PAGES FOLDER (>25 MiB raw copies)'
    $SkipLines
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
Write-Host "Large zips redirect to: $NetlifyBase"
$NetlifyHosted | ForEach-Object { Write-Host "  $_" }
if ($Skipped.Count -gt 0) {
    Write-Host 'Removed oversized local copies:'
    $Skipped | ForEach-Object { Write-Host "  $_" }
}
Write-Host 'See DEPLOY.txt in the folder for steps.'
