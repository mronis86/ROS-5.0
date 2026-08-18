/**
 * Zip a prebuilt PyInstaller exe for show / ingest PCs (no Python required).
 * Build first: cd hyperdeck-ingest && build-portable.bat
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const ingestRoot = path.join(projectRoot, 'hyperdeck-ingest');
const exePath = path.join(ingestRoot, 'dist', 'ROS-HyperDeck-Ingest.exe');
const zipPath = path.join(projectRoot, 'public', 'ros-hyperdeck-ingest.zip');
const prefix = 'ros-hyperdeck-ingest';
const exeName = 'ROS-HyperDeck-Ingest.exe';

if (!fs.existsSync(exePath)) {
  console.warn(
    'scripts/zip-hyperdeck-ingest.js: dist/ROS-HyperDeck-Ingest.exe not found.\n' +
      '  Run: cd hyperdeck-ingest && build-portable.bat\n' +
      '  Skipping zip (keeping existing public/ros-hyperdeck-ingest.zip if any).'
  );
  process.exit(0);
}

const publicDir = path.dirname(zipPath);
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

const startBat = `@echo off
setlocal
cd /d "%~dp0"
echo Starting ROS HyperDeck Ingest...
if not exist "%~dp0${exeName}" (
  echo ERROR: Missing ${exeName} next to this START.bat
  echo Unzip the full ros-hyperdeck-ingest folder and run START.bat from inside it.
  pause
  exit /b 1
)
start "" "%~dp0${exeName}"
endlocal
`;

const readme = `ROS HyperDeck Ingest (portable — no Python install)

1. Unzip this folder and double-click START.bat
   (or run ${exeName} from the same folder).
2. Paste your Railway API URL and Integration token (ros_itok_…, read scope).
3. Select the event, connect to the HyperDeck, set target folder, Start follow.

Settings: %LOCALAPPDATA%\\ros-hyperdeck-ingest\\config.json

Records cues marked Record when the timer is running; copies clips on stop.
`;

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });
archive.on('error', (err) => {
  console.error('zip-hyperdeck-ingest error:', err);
  process.exit(1);
});
archive.pipe(output);

archive.file(exePath, { name: `${prefix}/${exeName}` });
archive.append(startBat, { name: `${prefix}/START.bat` });
archive.append(readme, { name: `${prefix}/README.txt` });

archive.finalize();

output.on('close', () => {
  const mb = (archive.pointer() / (1024 * 1024)).toFixed(1);
  console.log(`Created public/ros-hyperdeck-ingest.zip (${mb} MB, portable exe)`);
});
