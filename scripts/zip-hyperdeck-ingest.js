/**
 * Zip hyperdeck-ingest to public/ros-hyperdeck-ingest.zip
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'hyperdeck-ingest');
const zipPath = path.join(projectRoot, 'public', 'ros-hyperdeck-ingest.zip');

if (!fs.existsSync(sourcePath)) {
  console.warn('scripts/zip-hyperdeck-ingest.js: hyperdeck-ingest not found, skipping.');
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
  ignore: ['__pycache__/**', '*.pyc', '.git/**', '*.zip', 'dist/**', 'build/**', '*.spec'],
  prefix: 'hyperdeck-ingest',
});
archive.finalize();

output.on('close', () => {
  console.log('Created public/ros-hyperdeck-ingest.zip');
});

archive.on('error', (err) => {
  console.error('zip-hyperdeck-ingest error:', err);
  process.exit(1);
});
