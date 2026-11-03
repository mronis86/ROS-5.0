/**
 * Zip a prebuilt Windows PowerPoint helper (win-unpacked) for show PCs.
 * Writes powerpoint-bridge-v2.zip (canonical) and mirrors powerpoint-bridge.zip.
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const bridgeRoot = path.join(projectRoot, 'powerpoint-bridge');
const zipPathV2 = path.join(projectRoot, 'public', 'powerpoint-bridge-v2.zip');
const zipPathLegacy = path.join(projectRoot, 'public', 'powerpoint-bridge.zip');
const prefix = 'powerpoint-bridge-v2';

function findUnpacked() {
  const candidates = [
    path.join(bridgeRoot, 'dist-openfix5', 'win-unpacked'),
    path.join(bridgeRoot, 'dist-openfix4', 'win-unpacked'),
    path.join(bridgeRoot, 'dist-openfix3', 'win-unpacked'),
    path.join(bridgeRoot, 'dist-openfix2', 'win-unpacked'),
    path.join(bridgeRoot, 'dist-openfix', 'win-unpacked'),
    path.join(bridgeRoot, 'dist-syncfix', 'win-unpacked'),
    path.join(bridgeRoot, 'dist-cuefix', 'win-unpacked'),
    path.join(bridgeRoot, 'dist-daypick', 'win-unpacked'),
    path.join(bridgeRoot, 'dist', 'win-unpacked'),
    path.join(bridgeRoot, 'dist-ready', 'win-unpacked'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

if (!fs.existsSync(bridgeRoot)) {
  console.warn('scripts/zip-powerpoint-bridge.js: powerpoint-bridge not found, skipping.');
  process.exit(0);
}

const unpackedDir = findUnpacked();
const publicDir = path.dirname(zipPathV2);
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

const output = fs.createWriteStream(zipPathV2);
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
    'ROS PowerPoint Bridge V2.exe';
  const startBat = `@echo off
setlocal
cd /d "%~dp0"
title ROS PowerPoint Bridge V2
echo Starting ROS PowerPoint Bridge V2...
if not exist "%~dp0${exeName}" (
  echo ERROR: Missing "${exeName}" next to this START.bat
  echo Unzip the full powerpoint-bridge-v2 folder first. Do not run from inside the zip window.
  pause
  exit /b 1
)
if not exist "%~dp0resources\\app.asar" (
  echo ERROR: Missing resources\\app.asar - zip is incomplete.
  echo Re-download powerpoint-bridge-v2.zip and unzip the whole folder.
  pause
  exit /b 1
)
start "" "%~dp0${exeName}"
endlocal
`;
  const readme = `ROS PowerPoint Bridge V2 (0.2.2)

Open/Loaded thrash fix build. Use this V2 zip only — quit any older bridge first.
Only one Mode 2 helper should run per event.

No Node.js / npm install required.

1. Unzip this folder completely. Do not run START.bat from inside the zip window.
2. Open PowerPoint with your deck.
3. Double-click START.bat (or the V2 .exe in the same folder).
4. Paste the Railway API URL and an integration token (ros_itok_...) with read,control,write.
5. Load events, pick the show.
6. PowerPoint Show with Timers: Capture stills, then Start follow.
7. ROS PPT Launcher: Sync decks (downloads decks + slide images), then Follow loaded cue or Manual open.

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
  try {
    fs.copyFileSync(zipPathV2, zipPathLegacy);
  } catch (err) {
    console.warn(`Could not mirror legacy powerpoint-bridge.zip (${err.message})`);
  }
  console.log(`Created ${zipPathV2} (${mb} MB) from ${from}`);
  console.log(`Mirrored ${zipPathLegacy}`);
});
