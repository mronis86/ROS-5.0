# Shared helpers for companion-network-fix bats.
$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CertDir = Join-Path $ScriptDir 'certs'
$ApiHost = 'ros-50-production.up.railway.app'
$ApiHealthUrl = "https://$ApiHost/health"
$ChainPemPath = Join-Path $CertDir 'api-chain.pem'

function Find-CompanionExe {
  $candidates = @(
    $env:COMPANION_EXE,
    'C:\Program Files\Companion\Companion.exe',
    'C:\Program Files\Bitfocus Companion\Companion.exe',
    'C:\Program Files (x86)\Companion\Companion.exe',
    'C:\Program Files (x86)\Bitfocus Companion\Companion.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Companion\Companion.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Bitfocus Companion\Companion.exe'),
    (Join-Path $env:LOCALAPPDATA 'Companion\Companion.exe')
  ) | Where-Object { $_ -and $_.Trim() }

  foreach ($path in $candidates) {
    if (Test-Path -LiteralPath $path) { return (Resolve-Path -LiteralPath $path).Path }
  }

  # Last resort: shallow search under Program Files
  $roots = @(
    ${env:ProgramFiles},
    ${env:ProgramFiles(x86)},
    $env:LOCALAPPDATA
  ) | Where-Object { $_ }

  foreach ($root in $roots) {
    try {
      $hit = Get-ChildItem -Path $root -Filter 'Companion.exe' -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($hit) { return $hit.FullName }
    } catch {}
  }

  return $null
}

function ConvertTo-Pem {
  param([System.Security.Cryptography.X509Certificates.X509Certificate2]$Cert)
  $bytes = $Cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
  $b64 = [Convert]::ToBase64String($bytes, 'InsertLineBreaks')
  return "-----BEGIN CERTIFICATE-----`r`n$b64`r`n-----END CERTIFICATE-----`r`n"
}

function Download-ApiCertChain {
  param([string]$OutPem = $ChainPemPath)

  if (-not (Test-Path -LiteralPath $CertDir)) {
    New-Item -ItemType Directory -Path $CertDir | Out-Null
  }

  Write-Host "Fetching certificate chain from $ApiHealthUrl ..."

  # Capture server cert during TLS handshake (works even if HTTP body fetch differs).
  $callback = {
    param($sender, $certificate, $chain, $sslPolicyErrors)
    if ($certificate) {
      $script:CapturedCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $certificate
    }
    if ($chain -and $chain.ChainElements) {
      $script:CapturedChain = @()
      foreach ($el in $chain.ChainElements) {
        $script:CapturedChain += New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $el.Certificate
      }
    }
    return $true
  }

  $script:CapturedCert = $null
  $script:CapturedChain = @()

  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $oldCallback = [Net.ServicePointManager]::ServerCertificateValidationCallback
  [Net.ServicePointManager]::ServerCertificateValidationCallback = $callback

  try {
    $req = [Net.HttpWebRequest]::Create($ApiHealthUrl)
    $req.Method = 'GET'
    $req.Timeout = 15000
    $req.ReadWriteTimeout = 15000
    try {
      $resp = $req.GetResponse()
      $resp.Close()
    } catch {
      # May still have captured certs even if HTTP/TLS policy complained.
    }
  } finally {
    [Net.ServicePointManager]::ServerCertificateValidationCallback = $oldCallback
  }

  $certs = @()
  if ($script:CapturedChain -and $script:CapturedChain.Count -gt 0) {
    $certs = $script:CapturedChain
  } elseif ($script:CapturedCert) {
    $certs = @($script:CapturedCert)
    try {
      $xchain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
      $xchain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
      [void]$xchain.Build($script:CapturedCert)
      if ($xchain.ChainElements.Count -gt 0) {
        $certs = @()
        foreach ($el in $xchain.ChainElements) {
          $certs += New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $el.Certificate
        }
      }
    } catch {}
  }

  if (-not $certs -or $certs.Count -eq 0) {
    throw "Could not capture TLS certificates from $ApiHealthUrl"
  }

  $pem = ($certs | ForEach-Object { ConvertTo-Pem $_ }) -join "`r`n"
  Set-Content -LiteralPath $OutPem -Value $pem -Encoding ASCII

  $i = 0
  foreach ($c in $certs) {
    $i++
    $safe = ($c.GetNameInfo('SimpleName', $false) -replace '[^a-zA-Z0-9._-]', '_')
    if (-not $safe) { $safe = "cert$i" }
    $cerPath = Join-Path $CertDir ("{0:00}-{1}.cer" -f $i, $safe)
    [IO.File]::WriteAllBytes($cerPath, $c.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
    Write-Host ("  [{0}] {1}" -f $i, $c.Subject)
  }

  Write-Host "Saved chain PEM: $OutPem"
  return $OutPem
}

function Start-CompanionProcess {
  param(
    [string]$ExePath,
    [hashtable]$ExtraEnv = @{}
  )

  if (-not $ExePath -or -not (Test-Path -LiteralPath $ExePath)) {
    throw "Companion.exe not found. Set COMPANION_EXE to the full path and retry."
  }

  Write-Host "Starting: $ExePath"
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $ExePath
  $psi.WorkingDirectory = Split-Path -Parent $ExePath
  $psi.UseShellExecute = $false

  # Windows PowerShell 5.1 uses EnvironmentVariables; PowerShell 7 uses Environment.
  $envMap = $null
  try { $envMap = $psi.EnvironmentVariables } catch {}
  if (-not $envMap) {
    try { $envMap = $psi.Environment } catch {}
  }
  if (-not $envMap) {
    throw "Could not access process environment map on this PowerShell version."
  }

  foreach ($k in @('NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED')) {
    if ($envMap.ContainsKey($k)) { $envMap.Remove($k) | Out-Null }
  }

  foreach ($k in $ExtraEnv.Keys) {
    if ($null -eq $ExtraEnv[$k] -or $ExtraEnv[$k] -eq '') {
      if ($envMap.ContainsKey($k)) { $envMap.Remove($k) | Out-Null }
    } else {
      $envMap[$k] = [string]$ExtraEnv[$k]
    }
  }

  [Diagnostics.Process]::Start($psi) | Out-Null
}
