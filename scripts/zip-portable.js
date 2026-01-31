/**
 * Zip ros-osc-control/dist to public/ROS-OSC-Control-portable.zip (cross-platform, for Netlify and local).
 * Same result as create-ros-osc-control-zip.ps1: extract gives a "dist" folder with exe and contents.
 */
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'ros-osc-control', 'dist');
const zipPath = path.join(projectRoot, 'public', 'ROS-OSC-Control-portable.zip');

if (!fs.existsSync(distPath)) {
  console.warn('scripts/zip-portable.js: ros-osc-control/dist not found, skipping zip.');
  process.exit(0);
}

const publicDir = path.dirname(zipPath);
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

archive.pipe(output);
archive.directory(distPath, 'dist');
archive.finalize();

output.on('close', () => {
  console.log('Created public/ROS-OSC-Control-portable.zip from ros-osc-control/dist');
});

archive.on('error', (err) => {
  console.error('zip-portable error:', err);
  process.exit(1);
});
