/**
 * Build offline UI and zip offline-show/ to public/offline-show.zip
 * for OSC modal download (LAN show laptop — no full ROS repo required).
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'offline-show');
const zipPath = path.join(projectRoot, 'public', 'offline-show.zip');
const buildUiScript = path.join(sourcePath, 'scripts', 'build-ui.js');

if (!fs.existsSync(sourcePath)) {
  console.warn('scripts/zip-offline-show.js: offline-show not found, skipping.');
  process.exit(0);
}

console.log('Building offline-show UI for zip...');
try {
  execSync(`node "${buildUiScript}"`, { cwd: projectRoot, stdio: 'inherit' });
} catch (err) {
  console.error('zip-offline-show: UI build failed.', err.message || err);
  process.exit(1);
}

const uiDistIndex = path.join(sourcePath, 'ui', 'dist', 'index.html');
if (!fs.existsSync(uiDistIndex)) {
  console.error('zip-offline-show: ui/dist/index.html missing after build.');
  process.exit(1);
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
    'ui/node_modules/**',
    'data/**',
    '**/*.db',
    '**/*.db-shm',
    '**/*.db-wal',
    '.git/**',
    '**/*.zip',
  ],
  prefix: 'offline-show',
});
archive.finalize();

output.on('close', () => {
  const mb = (archive.pointer() / (1024 * 1024)).toFixed(1);
  console.log(`Created public/offline-show.zip (${mb} MB)`);
});

archive.on('error', (err) => {
  console.error('zip-offline-show error:', err);
  process.exit(1);
});
