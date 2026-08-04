/**
 * Zip a prebuilt Windows app (win-unpacked / dist-ready) for show PCs.
 * Prefer newest dist-ready folder win-unpacked, else dist-transfer / dist.
 * No npm install on the target machine (avoids corporate SSL failures).
 *
 * Important: all Electron files must live under ros-vmix-datasource-bridge/
 * next to START.bat so the bat can find the .exe and resources/app.asar.
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const bridgeRoot = path.join(projectRoot, 'vmix-datasource-bridge');

function findUnpacked() {
  const readyDirs = fs
    .readdirSync(bridgeRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^dist-ready-/.test(d.name))
    .map((d) => ({
      name: d.name,
      mtime: fs.statSync(path.join(bridgeRoot, d.name)).mtimeMs,
      path: path.join(bridgeRoot, d.name, 'win-unpacked'),
    }))
    .filter((d) => fs.existsSync(d.path))
    .sort((a, b) => b.mtime - a.mtime);
  if (readyDirs[0]) return readyDirs[0].path;

  const candidates = [
    path.join(bridgeRoot, 'dist-transfer', 'win-unpacked'),
    path.join(bridgeRoot, 'dist', 'win-unpacked'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const unpackedDir = findUnpacked();
const zipPath = path.join(projectRoot, 'public', 'ros-vmix-datasource-bridge.zip');
const prefix = 'ros-vmix-datasource-bridge';

if (!unpackedDir) {
  console.warn(
    'scripts/zip-vmix-datasource-bridge.js: no win-unpacked found.\n' +
      '  Run: cd vmix-datasource-bridge && npx electron-builder --win dir --x64\n' +
      '  Skipping zip.'
  );
  process.exit(0);
}

const exeName =
  fs.readdirSync(unpackedDir).find((n) => n.toLowerCase().endsWith('.exe') && !/elevate/i.test(n)) ||
  'ROS vMix DataSource Bridge.exe';

const publicDir = path.dirname(zipPath);
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

const startBat = `@echo off
setlocal
cd /d "%~dp0"
echo Starting ROS vMix DataSource Bridge...
echo No npm install needed.
if not exist "%~dp0${exeName}" (
  echo ERROR: Missing "${exeName}" next to this START.bat
  echo Unzip the full ros-vmix-datasource-bridge folder and run START.bat from inside it.
  pause
  exit /b 1
)
if not exist "%~dp0resources\\app.asar" (
  echo ERROR: Missing resources\\app.asar - zip is incomplete.
  echo Re-download ros-vmix-datasource-bridge.zip and unzip the whole folder.
  pause
  exit /b 1
)
start "" "%~dp0${exeName}"
endlocal
`;

const readme = `ROS vMix DataSource Bridge (prebuilt)

No Node.js / npm install required on the show PC.

1. Unzip the zip - keep the ros-vmix-datasource-bridge folder intact.
2. Open that folder and double-click START.bat
   (or run "ROS vMix DataSource Bridge.exe" from the same folder).
3. Go to the Connections tab to set Railway API URL + token + event.
4. On Sources, type the exact Data Source name from vMix.
5. Sheet blank for XML/CSV; set sheet for Excel/Google Sheets.

Do not move the .exe out of this folder without resources\\app.asar beside it.

Corporate networks that block Electron downloads should use this package.
`;

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });
archive.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
archive.pipe(output);

// Put entire win-unpacked tree under ros-vmix-datasource-bridge/ (exe + resources + dlls).
// prefix MUST be the 3rd glob argument — putting it in options silently drops it.
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
archive.finalize();

output.on('close', () => {
  const mb = (archive.pointer() / (1024 * 1024)).toFixed(2);
  console.log(`Created ${zipPath} (${mb} MB) from ${unpackedDir}`);
});
