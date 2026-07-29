/**
 * Zip the built portable EXE into public/ros-vmix-datasource-bridge.zip
 * for Graphics Links download.
 *
 * Requires a prior local build:
 *   cd vmix-datasource-bridge && npm run build:portable
 *
 * Output: single-folder zip with the .exe + short README (no Node.js / npm on target PCs).
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'vmix-datasource-bridge', 'dist');
const zipPath = path.join(projectRoot, 'public', 'ros-vmix-datasource-bridge.zip');

function findPortableExe() {
  if (!fs.existsSync(distDir)) return null;
  const match = fs
    .readdirSync(distDir)
    .find((name) => /^ROS-vMix-DataSource-Bridge-.*-portable\.exe$/i.test(name));
  return match ? path.join(distDir, match) : null;
}

const exePath = findPortableExe();
if (!exePath) {
  console.warn(
    'scripts/zip-vmix-datasource-bridge.js: portable exe not found.\n' +
      '  Run: cd vmix-datasource-bridge && npm run build:portable\n' +
      '  Skipping zip (keeping existing public/ros-vmix-datasource-bridge.zip if present).'
  );
  process.exit(0);
}

const publicDir = path.dirname(zipPath);
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const readmeText = `ROS vMix DataSource Bridge (portable)

No Node.js or npm install required.

1. Unzip this folder anywhere (Desktop, USB, etc.).
2. Double-click ROS-vMix-DataSource-Bridge-*-portable.exe
3. Enter Railway API URL + integration token (read scope).
4. Pick event, test vMix, add Data Source bindings, click Start.

Requirements:
- Windows 10/11 (x64)
- vMix with Web Controller enabled (default http://127.0.0.1:8088)
- Network access to your ROS Railway API

Config is stored under %LOCALAPPDATA%\\ros-vmix-datasource\\
`;

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

archive.on('error', (err) => {
  console.error('zip-vmix-datasource-bridge error:', err);
  process.exit(1);
});

archive.pipe(output);
archive.file(exePath, {
  name: `ros-vmix-datasource-bridge/${path.basename(exePath)}`,
});
archive.append(readmeText, {
  name: 'ros-vmix-datasource-bridge/README.txt',
});
archive.finalize();

output.on('close', () => {
  const mb = (archive.pointer() / (1024 * 1024)).toFixed(2);
  console.log(`Created public/ros-vmix-datasource-bridge.zip (${mb} MB) from ${path.basename(exePath)}`);
});
