/**
 * Zip ros-osc-python-app to public/ros-osc-python-app.zip
 * Excludes __pycache__, .pyc, etc. Cross-platform for Netlify builds.
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'ros-osc-python-app');
const zipPath = path.join(projectRoot, 'public', 'ros-osc-python-app.zip');

if (!fs.existsSync(sourcePath)) {
  console.warn('scripts/zip-python-app.js: ros-osc-python-app not found, skipping.');
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
  ignore: ['__pycache__/**', '*.pyc', '.git/**', '*.zip'],
  prefix: 'ros-osc-python-app'
});
archive.finalize();

output.on('close', () => {
  console.log('Created public/ros-osc-python-app.zip');
});

archive.on('error', (err) => {
  console.error('zip-python-app error:', err);
  process.exit(1);
});
