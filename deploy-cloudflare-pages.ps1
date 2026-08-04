# Pack Cloudflare folder (large zips redirect to Netlify) and deploy to Pages ros1615.
# Run from repo root in an interactive terminal (wrangler login):
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy-cloudflare-pages.ps1

param(
    [string]$ProjectName = 'ros1615',
    [string]$NetlifyDownloadsBase = 'https://ros1615.netlify.app',
    [switch]$SkipPack
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location $ProjectRoot

$DateStr = Get-Date -Format 'yyyy-MM-dd'
$UploadDir = Join-Path $ProjectRoot "cloudflare-$DateStr-V2"

if (-not $SkipPack) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot 'create-cloudflare-dated.ps1') `
        -NetlifyDownloadsBase $NetlifyDownloadsBase
}

if (-not (Test-Path (Join-Path $UploadDir 'index.html'))) {
    Write-Error "Missing $UploadDir - pack failed."
    exit 1
}

Write-Host "========== Deploying $UploadDir -> Pages $ProjectName =========="
npx --yes wrangler pages deploy $UploadDir --project-name=$ProjectName --commit-dirty=true
Write-Host "Done. Production: https://$ProjectName.pages.dev"
Write-Host "Large zips redirect to: $NetlifyDownloadsBase"
