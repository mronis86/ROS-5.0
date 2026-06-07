# Build site into netlify-YYYY-MM-DD-V2 (same as create-netlify-dated.ps1).
# Run from repository root.

$ErrorActionPreference = 'Stop'
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
& (Join-Path $ScriptDir 'create-netlify-dated.ps1')
