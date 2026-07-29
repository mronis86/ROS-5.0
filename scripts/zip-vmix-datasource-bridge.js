/**
 * Zip vmix-datasource-bridge/ to public/ros-vmix-datasource-bridge.zip
 * for Graphics Links download. Source-only (no node_modules) — START.bat
 * runs npm install on first launch.
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'vmix-datasource-bridge');
const zipPath = path.join(projectRoot, 'public', 'ros-vmix-datasource-bridge.zip');

if (!fs.existsSync(sourcePath)) {
  console.warn('scripts/zip-vmix-datasource-bridge.js: vmix-datasource-bridge not found, skipping.');
  process.exit(0);
}

const required = ['package.json', 'START.bat', 'electron/main.js', 'renderer/index.html'];
for (const rel of required) {
  if (!fs.existsSync(path.join(sourcePath, rel))) {
    console.error(`zip-vmix-datasource-bridge: missing ${rel}`);
    process.exit(1);
  }
}

const publicDir = path.dirname(zipPath);
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

archive.pipe(output);
archive.glob('**/*', {
  cwd: sourcePath,
  dot: false,
  ignore: [
    'node_modules/**',
    'dist/**',
    '.git/**',
    '**/*.zip',
    '**/*.log',
    '**/*.lnk',
  ],
  prefix: 'ros-vmix-datasource-bridge',
});
archive.finalize();

output.on('close', () => {
  const mb = (archive.pointer() / (1024 * 1024)).toFixed(2);
  console.log(`Created public/ros-vmix-datasource-bridge.zip (${mb} MB)`);
});

archive.on('error', (err) => {
  console.error('zip-vmix-datasource-bridge error:', err);
  process.exit(1);
});
