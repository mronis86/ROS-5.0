/**
 * Zip spout-bridge/ to public/ros-led-spout.zip for LED layouts page download.
 * Source-only (no node_modules) — launcher runs npm install on first start.
 * SpoutLibrary.dll is not bundled; see spout-bridge/vendor/README.md.
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'spout-bridge');
const zipPath = path.join(projectRoot, 'public', 'ros-led-spout.zip');

if (!fs.existsSync(sourcePath)) {
  console.warn('scripts/zip-spout-bridge.js: spout-bridge not found, skipping.');
  process.exit(0);
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
    'vendor/SpoutLibrary.dll',
    '.git/**',
    '**/*.zip',
    '**/*.log',
  ],
  prefix: 'ros-led-spout',
});
archive.finalize();

output.on('close', () => {
  const mb = (archive.pointer() / (1024 * 1024)).toFixed(2);
  console.log(`Created public/ros-led-spout.zip (${mb} MB)`);
});

archive.on('error', (err) => {
  console.error('zip-spout-bridge error:', err);
  process.exit(1);
});
