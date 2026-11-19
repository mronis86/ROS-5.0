/**
 * Zip electron-builder win-unpacked → ROS-Offline-Kiosk-Portable.zip
 * and copy START.bat into the unpacked folder if missing.
 *
 * Usage:
 *   node scripts/zip-portable-out.js
 *   node scripts/zip-portable-out.js dist-ship-20261118-181926
 *   node scripts/zip-portable-out.js path/to/dir-with-win-unpacked
 *
 * Packaging order (Windows Explorer–compatible entry names, no "./" prefix):
 *   1. System.IO.Compression.ZipFile.CreateFromDirectory (PowerShell / .NET)
 *   2. 7z a -tzip (if 7z is on PATH)
 *   3. Compress-Archive (last resort)
 *
 * Do NOT use `tar -a -c -C dir .` — it stores entries as `./file` which
 * Explorer and many extractors reject as invalid/empty.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync, execSync } = require('child_process');

const kioskRoot = path.resolve(__dirname, '..');
const arg = process.argv[2] ? String(process.argv[2]).trim() : '';
const outRoot = arg
  ? path.isAbsolute(arg)
    ? arg
    : path.join(kioskRoot, arg)
  : path.join(kioskRoot, 'dist');

const unpacked = path.join(outRoot, 'win-unpacked');
const startSrc = path.join(kioskRoot, 'launcher', 'START-PORTABLE.bat');
const zipOut = path.join(outRoot, 'ROS-Offline-Kiosk-Portable.zip');
const EXE_NAME = 'ROS Offline Kiosk V4.exe';

if (!fs.existsSync(unpacked)) {
  console.error(`Missing ${unpacked} — run electron-builder --win dir first`);
  process.exit(1);
}

const exePath = path.join(unpacked, EXE_NAME);
if (!fs.existsSync(exePath)) {
  console.error(`Missing ${exePath} — win-unpacked looks incomplete`);
  process.exit(1);
}

const startDest = path.join(unpacked, 'START.bat');
if (fs.existsSync(startSrc)) {
  fs.copyFileSync(startSrc, startDest);
}

if (fs.existsSync(zipOut)) fs.unlinkSync(zipOut);

function psLiteral(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function find7z() {
  const candidates = [
    '7z',
    '7za',
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', '7-Zip', '7z.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', '7-Zip', '7z.exe'),
  ];
  for (const c of candidates) {
    try {
      if (c.includes('\\') || c.includes('/')) {
        if (fs.existsSync(c)) return c;
      } else {
        execSync(`where ${c}`, { stdio: 'ignore', windowsHide: true });
        return c;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Prefer .NET ZipFile — entry names are relative without "./" */
function zipWithDotNet() {
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = ${psLiteral(unpacked)}
$dst = ${psLiteral(zipOut)}
if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $src,
  $dst,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)
`;
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    stdio: 'inherit',
    windowsHide: true,
  });
}

function zipWith7z(sevenZip) {
  execFileSync(sevenZip, ['a', '-tzip', '-mx=5', zipOut, '.'], {
    cwd: unpacked,
    stdio: 'inherit',
    windowsHide: true,
  });
}

function zipWithCompressArchive() {
  const ps = `
$ErrorActionPreference='Stop'
Compress-Archive -Path ${psLiteral(path.join(unpacked, '*'))} -DestinationPath ${psLiteral(zipOut)} -Force
`;
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    stdio: 'inherit',
    windowsHide: true,
  });
}

/**
 * Verify archive opens, has no "./" entry prefixes, and contains the exe at root.
 * Optionally extracts one small non-exe file via .NET to prove readability.
 */
function verifyZip(zipPath) {
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = ${psLiteral(zipPath)}
$exeName = ${psLiteral(EXE_NAME)}
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $names = @($zip.Entries | ForEach-Object { $_.FullName })
  $bad = @($names | Where-Object { $_ -like './*' -or $_ -like '.\\*' })
  if ($bad.Count -gt 0) {
    Write-Output ('BAD_PREFIX_COUNT=' + $bad.Count)
    $bad | Select-Object -First 8 | ForEach-Object { Write-Output ('BAD_SAMPLE=' + $_) }
    exit 2
  }
  $hasExe = $names | Where-Object { $_ -eq $exeName -or $_ -eq ($exeName + '/') }
  if (-not $hasExe) {
    Write-Output 'MISSING_EXE_AT_ROOT=1'
    $names | Select-Object -First 15 | ForEach-Object { Write-Output ('ENTRY=' + $_) }
    exit 3
  }
  Write-Output ('ENTRY_COUNT=' + $names.Count)
  $names | Select-Object -First 12 | ForEach-Object { Write-Output ('ENTRY=' + $_) }
  # Extract one small file (prefer LICENSE* / *.json / *.bat under root)
  $probe = $zip.Entries |
    Where-Object {
      -not $_.FullName.EndsWith('/') -and
      $_.FullName -notlike '*/*' -and
      $_.FullName -ne $exeName -and
      $_.Length -gt 0 -and
      $_.Length -lt 200000
    } |
    Select-Object -First 1
  if ($probe) {
    $tmp = Join-Path $env:TEMP ('ros-zip-probe-' + [guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
      $outFile = Join-Path $tmp (Split-Path $probe.FullName -Leaf)
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($probe, $outFile, $true)
      $len = (Get-Item -LiteralPath $outFile).Length
      Write-Output ('PROBE_OK=' + $probe.FullName + ';bytes=' + $len)
    } finally {
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
  } else {
    Write-Output 'PROBE_SKIP=no_small_root_file'
  }
  Write-Output 'VERIFY_OK=1'
} finally {
  $zip.Dispose()
}
`;
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { encoding: 'utf8', windowsHide: true }
  );
  process.stdout.write(out);
  if (!/VERIFY_OK=1/.test(out)) {
    throw new Error('Zip verification failed');
  }
  if (/BAD_PREFIX_COUNT=/.test(out) || /MISSING_EXE_AT_ROOT=/.test(out)) {
    throw new Error('Zip entry names invalid');
  }
}

let method = '';
const errors = [];

try {
  zipWithDotNet();
  method = 'ZipFile.CreateFromDirectory';
} catch (e) {
  errors.push('dotnet: ' + (e instanceof Error ? e.message : e));
  if (fs.existsSync(zipOut)) {
    try {
      fs.unlinkSync(zipOut);
    } catch {
      /* ignore */
    }
  }
  const seven = find7z();
  if (seven) {
    try {
      zipWith7z(seven);
      method = '7z';
    } catch (e2) {
      errors.push('7z: ' + (e2 instanceof Error ? e2.message : e2));
      if (fs.existsSync(zipOut)) {
        try {
          fs.unlinkSync(zipOut);
        } catch {
          /* ignore */
        }
      }
    }
  } else {
    errors.push('7z: not found');
  }
}

if (!method) {
  console.warn('Primary zip methods failed; using Compress-Archive last resort:', errors.join(' | '));
  zipWithCompressArchive();
  method = 'Compress-Archive';
}

if (!fs.existsSync(zipOut)) {
  console.error('Zip was not created');
  process.exit(1);
}

console.log(`Packaging method: ${method}`);
verifyZip(zipOut);

const bytes = fs.statSync(zipOut).size;
const mb = (bytes / (1024 * 1024)).toFixed(1);
console.log(`Created ${zipOut} (${mb} MB, ${bytes} bytes)`);
