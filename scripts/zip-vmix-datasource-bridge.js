/**
 * Zip a prebuilt Windows app (win-unpacked / dist-transfer) for show PCs.
 * Prefer dist-transfer/win-unpacked, else dist/win-unpacked.
 * No npm install on the target machine (avoids corporate SSL failures).
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
start "" "%~dp0${exeName}"
endlocal
`;

const readme = `ROS vMix DataSource Bridge (prebuilt)

No Node.js / npm install required on the show PC.

1. Unzip anywhere.
2. Double-click START.bat
3. Type the exact Data Source name from vMix Data Sources Manager.
4. Sheet blank for XML/CSV; set sheet for Excel/Google Sheets.

Corporate networks that block Electron downloads should use this package.
`;

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });
archive.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
archive.pipe(output);
archive.glob('**/*', {
  cwd: unpackedDir,
  ignore: [
    'locales/**',
    'LICENSES.chromium.html',
    'vk_swiftshader.dll',
    'vk_swiftshader_icd.json',
    'vulkan-1.dll',
  ],
  prefix,
});
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
