/**
 * Zip electron-builder win-unpacked → dist/ROS-Offline-Kiosk-Portable.zip
 * and copy START.bat into the unpacked folder if missing.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const kioskRoot = path.resolve(__dirname, '..');
const unpacked = path.join(kioskRoot, 'dist', 'win-unpacked');
const startSrc = path.join(kioskRoot, 'launcher', 'START-PORTABLE.bat');
const zipOut = path.join(kioskRoot, 'dist', 'ROS-Offline-Kiosk-Portable.zip');

if (!fs.existsSync(unpacked)) {
  console.error('Missing dist/win-unpacked — run electron-builder --win dir first');
  process.exit(1);
}

const startDest = path.join(unpacked, 'START.bat');
if (fs.existsSync(startSrc)) {
  fs.copyFileSync(startSrc, startDest);
}

if (fs.existsSync(zipOut)) fs.unlinkSync(zipOut);

const ps = `
$ErrorActionPreference='Stop'
Compress-Archive -Path '${unpacked.replace(/'/g, "''")}\\*' -DestinationPath '${zipOut.replace(/'/g, "''")}' -Force
`;
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
  stdio: 'inherit',
});

const mb = (fs.statSync(zipOut).size / (1024 * 1024)).toFixed(1);
console.log(`Created ${zipOut} (${mb} MB)`);
