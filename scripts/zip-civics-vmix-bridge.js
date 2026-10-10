/**
 * Zip prebuilt Civics vMix bridge (win-unpacked) for show PCs.
 * Prefer civics-vmix-bridge/dist-ready/win-unpacked.
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const bridgeRoot = path.join(projectRoot, 'civics-vmix-bridge');

function findUnpacked() {
  const readyDirs = fs.existsSync(bridgeRoot)
    ? fs
        .readdirSync(bridgeRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^dist-ready/.test(d.name))
        .map((d) => ({
          path: path.join(bridgeRoot, d.name, 'win-unpacked'),
          mtime: fs.statSync(path.join(bridgeRoot, d.name)).mtimeMs,
        }))
        .filter((d) => fs.existsSync(d.path))
        .sort((a, b) => b.mtime - a.mtime)
    : [];
  if (readyDirs[0]) return readyDirs[0].path;
  const fallback = path.join(bridgeRoot, 'dist', 'win-unpacked');
  return fs.existsSync(fallback) ? fallback : null;
}

const unpackedDir = findUnpacked();
const zipPath = path.join(projectRoot, 'public', 'ros-civics-vmix-bridge.zip');
const prefix = 'ros-civics-vmix-bridge';

if (!unpackedDir) {
  console.warn(
    'scripts/zip-civics-vmix-bridge.js: no win-unpacked found.\n' +
      '  Run: cd civics-vmix-bridge && npm install && npx electron-builder --win dir --x64\n' +
      '  Skipping zip.'
  );
  process.exit(0);
}

const exeName =
  fs.readdirSync(unpackedDir).find((n) => n.toLowerCase().endsWith('.exe') && !/elevate/i.test(n)) ||
  'ROS Civics vMix Bridge.exe';

const publicDir = path.dirname(zipPath);
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

const startBat = `@echo off
setlocal
cd /d "%~dp0"
echo Starting ROS Civics vMix Bridge...
if not exist "%~dp0${exeName}" (
  echo ERROR: Missing "${exeName}" next to this START.bat
  pause
  exit /b 1
)
if not exist "%~dp0resources\\app.asar" (
  echo ERROR: Missing resources\\app.asar - zip is incomplete.
  pause
  exit /b 1
)
start "" "%~dp0${exeName}"
endlocal
`;

const readme = `ROS Civics vMix Bridge (prebuilt)

1. Unzip this folder on the vMix PC.
2. Run START.bat
3. Set Event ID + Data Source names for Top 25 / 10 / 5
4. Start — then use ROS Civics Top 25/10/5 button pages

Runs in parallel with the everyday ROS vMix DataSource Bridge.
`;

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });
archive.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
output.on('close', () => {
  const mb = (archive.pointer() / (1024 * 1024)).toFixed(2);
  console.log(`Created public/ros-civics-vmix-bridge.zip (${mb} MB) from ${unpackedDir}`);
});

archive.pipe(output);
archive.directory(unpackedDir, prefix);
archive.append(startBat, { name: `${prefix}/START.bat` });
archive.append(readme, { name: `${prefix}/README.txt` });
archive.finalize();
