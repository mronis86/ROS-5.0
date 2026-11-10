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

fs.writeFileSync(
  path.join(stageDir, 'HOWTO.txt'),
  [
    'ROS Green Room Client — portable (no install)',
    '',
    '1. Unzip this folder anywhere (USB is fine).',
    '2. Double-click "Start Green Room Client.bat".',
    '3. Paste your Integration token (ros_itok_…) — same as Offline Kiosk.',
    '4. Leave the window open. The PC shows on Offline Kiosk → Status → Green Room clients.',
    '5. On the kiosk: select an event, then Start on this client.',
    '',
    'No Node / npm install required on Windows.',
    '',
  ].join('\r\n'),
  'utf8'
);

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
