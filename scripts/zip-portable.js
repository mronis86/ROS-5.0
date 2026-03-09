/**
 * Zip only ros-osc-control/dist/win-unpacked to public/ROS-OSC-Control-portable.zip.
 * Extract gives a single "win-unpacked" folder with the runnable app (exe + resources).
 * Requires: cd ros-osc-control && npm run build:portable (builds portable + dir so win-unpacked exists).
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const winUnpackedPath = path.join(projectRoot, 'ros-osc-control', 'dist', 'win-unpacked');
const zipPath = path.join(projectRoot, 'public', 'ROS-OSC-Control-portable.zip');

if (!fs.existsSync(winUnpackedPath)) {
  console.warn('scripts/zip-portable.js: ros-osc-control/dist/win-unpacked not found.');
  console.warn('Build the Electron app with dir target first: cd ros-osc-control && npm run build:portable');
  process.exit(0);
}

const publicDir = path.dirname(zipPath);
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

archive.pipe(output);
archive.directory(winUnpackedPath, 'win-unpacked');
archive.finalize();

output.on('close', () => {
  console.log('Created public/ROS-OSC-Control-portable.zip from ros-osc-control/dist/win-unpacked');
});

archive.on('error', (err) => {
  console.error('zip-portable error:', err);
  process.exit(1);
});
