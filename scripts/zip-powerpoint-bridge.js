/**
 * Zip a prebuilt Windows PowerPoint helper (win-unpacked) for show PCs.
 * Falls back to source-only if no unpacked build exists.
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const bridgeRoot = path.join(projectRoot, 'powerpoint-bridge');
const zipPath = path.join(projectRoot, 'public', 'powerpoint-bridge.zip');
const prefix = 'powerpoint-bridge';

function findUnpacked() {
  const candidates = [
    path.join(bridgeRoot, 'dist-ready', 'win-unpacked'),
    path.join(bridgeRoot, 'dist', 'win-unpacked'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

if (!fs.existsSync(bridgeRoot)) {
  console.warn('scripts/zip-powerpoint-bridge.js: powerpoint-bridge not found, skipping.');
  process.exit(0);
}

const unpackedDir = findUnpacked();
const publicDir = path.dirname(zipPath);
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

const output = fs.createWriteStream(zipPath);
output.on('error', (err) => {
  console.warn(`Skipping powerpoint zip rewrite (${err.message}). Keeping the existing file.`);
  process.exit(0);
});
const archive = archiver('zip', { zlib: { level: 9 } });
archive.on('error', (err) => {
  console.error('zip-powerpoint-bridge error:', err);
  process.exit(1);
});
archive.pipe(output);

if (unpackedDir) {
  const exeName =
    fs.readdirSync(unpackedDir).find((n) => n.toLowerCase().endsWith('.exe') && !/elevate/i.test(n)) ||
    'ROS PowerPoint Bridge.exe';
  const startBat = `@echo off
setlocal
cd /d "%~dp0"
title ROS PowerPoint Bridge
echo Starting ROS PowerPoint Bridge...
if not exist "%~dp0${exeName}" (
  echo ERROR: Missing "${exeName}" next to this START.bat
  echo Unzip the full powerpoint-bridge folder first. Do not run from inside the zip window.
  pause
  exit /b 1
)
if not exist "%~dp0resources\\app.asar" (
  echo ERROR: Missing resources\\app.asar - zip is incomplete.
  echo Re-download powerpoint-bridge.zip and unzip the whole folder.
  pause
  exit /b 1
)
start "" "%~dp0${exeName}"
endlocal
`;
  const readme = `ROS PowerPoint Bridge (prebuilt)

No Node.js / npm install required.

1. Unzip this folder completely. Do not run START.bat from inside the zip window.
2. Open PowerPoint with your deck.
3. Double-click START.bat (or ROS PowerPoint Bridge.exe in the same folder).
4. Paste the Railway API URL and an integration token (ros_itok_...) with read,control,write.
5. Load events, pick the show.
6. PowerPoint Show with Timers: Capture stills, then Start follow.
7. ROS PPT Launcher: Sync cache, then Follow loaded cue.

Keep the .exe next to resources\\app.asar.
`;
  archive.glob(
    '**/*',
    {
      cwd: unpackedDir,
      ignore: [
        'locales/**',
        'LICENSES.chromium.html',
        'vk_swiftshader.dll',
        'vk_swiftshader_icd.json',
        'vulkan-1.dll',
      ],
    },
    { prefix }
  );
  const enUs = path.join(unpackedDir, 'locales', 'en-US.pak');
  if (fs.existsSync(enUs)) {
    archive.file(enUs, { name: `${prefix}/locales/en-US.pak` });
  }
  archive.append(startBat, { name: `${prefix}/START.bat` });
  archive.append(readme, { name: `${prefix}/README.txt` });
} else {
  archive.glob(
    '**/*',
    {
      cwd: bridgeRoot,
      dot: false,
      ignore: ['node_modules/**', 'dist/**', 'dist-ready/**', '.git/**'],
    },
    { prefix }
  );
}

archive.finalize();
output.on('close', () => {
  const mb = (archive.pointer() / (1024 * 1024)).toFixed(2);
  const from = unpackedDir || 'source';
  console.log(`Created ${zipPath} (${mb} MB) from ${from}`);
});
