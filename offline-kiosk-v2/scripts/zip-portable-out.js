/**
 * Zip electron-builder win-unpacked → ROS-Offline-Kiosk-Portable.zip
 * and copy START.bat into the unpacked folder if missing.
 *
 * Usage:
 *   node scripts/zip-portable-out.js
 *   node scripts/zip-portable-out.js dist-ship-20261118-181926
 *   node scripts/zip-portable-out.js path/to/dir-with-win-unpacked
 *
 * Prefers `tar -a` (Windows built-in) over Compress-Archive for ~300MB Electron trees.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

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

if (!fs.existsSync(unpacked)) {
  console.error(`Missing ${unpacked} — run electron-builder --win dir first`);
  process.exit(1);
}

const startDest = path.join(unpacked, 'START.bat');
if (fs.existsSync(startSrc)) {
  fs.copyFileSync(startSrc, startDest);
}

if (fs.existsSync(zipOut)) fs.unlinkSync(zipOut);

function zipWithTar() {
  // tar -a -c -f creates zip on Windows when extension is .zip
  execFileSync(
    'tar.exe',
    ['-a', '-c', '-f', zipOut, '-C', unpacked, '.'],
    { stdio: 'inherit', windowsHide: true }
  );
}

function zipWithCompressArchive() {
  const ps = `
$ErrorActionPreference='Stop'
Compress-Archive -Path '${unpacked.replace(/'/g, "''")}\\*' -DestinationPath '${zipOut.replace(/'/g, "''")}' -Force
`;
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    stdio: 'inherit',
  });
}

try {
  zipWithTar();
} catch (e) {
  console.warn('tar zip failed, falling back to Compress-Archive:', e instanceof Error ? e.message : e);
  if (fs.existsSync(zipOut)) {
    try {
      fs.unlinkSync(zipOut);
    } catch {
      /* ignore */
    }
  }
  zipWithCompressArchive();
}

const mb = (fs.statSync(zipOut).size / (1024 * 1024)).toFixed(1);
console.log(`Created ${zipOut} (${mb} MB)`);
