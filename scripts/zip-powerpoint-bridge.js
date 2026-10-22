/**
 * Zip powerpoint-bridge to public/powerpoint-bridge.zip
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'powerpoint-bridge');
const zipPath = path.join(projectRoot, 'public', 'powerpoint-bridge.zip');

if (!fs.existsSync(sourcePath)) {
  console.warn('scripts/zip-powerpoint-bridge.js: powerpoint-bridge not found, skipping.');
  process.exit(0);
}

const publicDir = path.dirname(zipPath);
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

archive.on('error', (err) => {
  console.error('zip-powerpoint-bridge error:', err);
  process.exit(1);
});
output.on('close', () => {
  console.log('Created public/powerpoint-bridge.zip');
});

archive.pipe(output);
archive.glob('**/*', {
  cwd: sourcePath,
  dot: false,
  ignore: ['node_modules/**', 'dist/**', '.git/**'],
  prefix: 'powerpoint-bridge',
});
archive.finalize();
