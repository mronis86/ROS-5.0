/**
 * Build public/ros-green-room-client-portable.zip (unzip → double-click .bat).
 * Usage: node green-room-client/scripts/pack-portable.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const clientRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(clientRoot, '..');
const outZip = path.join(projectRoot, 'public', 'ros-green-room-client-portable.zip');
const stageRoot = path.join(clientRoot, '.pack-stage');
const stageDir = path.join(stageRoot, 'ros-green-room-client');

const FILES = [
  'Start Green Room Client.bat',
  'GreenRoomClient.ps1',
  'HOWTO.txt',
  'client.js',
  'config.example.json',
  'package.json',
  'README.md',
];

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

rmrf(stageRoot);
fs.mkdirSync(stageDir, { recursive: true });

for (const name of FILES) {
  const src = path.join(clientRoot, name);
  if (!fs.existsSync(src)) throw new Error(`Missing ${name}`);
  fs.copyFileSync(src, path.join(stageDir, name));
}

// Prefer repo HOWTO.txt (ASCII). Keep a fallback if missing.
if (!fs.existsSync(path.join(stageDir, 'HOWTO.txt'))) {
  fs.writeFileSync(
    path.join(stageDir, 'HOWTO.txt'),
    [
      'ROS Green Room Client - portable (no install)',
      '',
      '1. Unzip anywhere (USB is fine).',
      '2. Double-click "Start Green Room Client.bat".',
      '3. First run: paste Integration token (same as Offline Kiosk).',
      '4. Look by the Windows clock for the green tray icon.',
      '5. Right-click tray icon to Exit. Kiosk Status can Start this PC.',
      '',
    ].join('\r\n'),
    'ascii'
  );
}

// Ensure the .ps1 is UTF-8 with BOM so Windows PowerShell 5.1 does not
// mis-read the file (that caused the "string missing terminator" crash).
const ps1Path = path.join(stageDir, 'GreenRoomClient.ps1');
const ps1Body = fs.readFileSync(ps1Path);
if (!(ps1Body[0] === 0xef && ps1Body[1] === 0xbb && ps1Body[2] === 0xbf)) {
  fs.writeFileSync(ps1Path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), ps1Body]));
}

fs.mkdirSync(path.dirname(outZip), { recursive: true });
if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

const stageFolder = stageDir.replace(/'/g, "''");
const outPosix = outZip.replace(/'/g, "''");
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    // Zip contains ros-green-room-client/… so unzip makes one clean folder.
    `Compress-Archive -Path '${stageFolder}' -DestinationPath '${outPosix}' -Force`,
  ],
  { stdio: 'inherit' }
);

rmrf(stageRoot);

const mb = (fs.statSync(outZip).size / (1024 * 1024)).toFixed(2);
console.log(`Wrote ${outZip} (${mb} MB)`);
console.log('Upload: node scripts/upload-app-download.js public/ros-green-room-client-portable.zip');
