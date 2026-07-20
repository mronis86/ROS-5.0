/**
 * Create companion-module-runofshow-mitti-full.zip including node_modules.
 * Run from project root. Served from OSC Control modal download.
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'companion-module-runofshow-mitti');
const zipPath = path.join(projectRoot, 'public', 'companion-module-runofshow-mitti-full.zip');

if (!fs.existsSync(sourcePath)) {
  console.warn('scripts/zip-companion-module-mitti-full.js: companion-module-runofshow-mitti not found, skipping.');
  process.exit(0);
}

console.log('Installing dependencies in companion-module-runofshow-mitti...');
const installCmd = process.env.CI === 'true' ? 'npm ci' : 'npm install';
execSync(installCmd, { cwd: sourcePath, stdio: 'inherit' });

const publicDir = path.dirname(zipPath);
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const archiver = require('archiver');
const output = fs.createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

archive.pipe(output);
archive.glob('**/*', {
  cwd: sourcePath,
  dot: true,
  ignore: ['.git/**'],
  prefix: 'companion-module-runofshow-mitti',
});
archive.finalize();

output.on('close', () => {
  const stat = fs.statSync(zipPath);
  const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
  console.log('Created public/companion-module-runofshow-mitti-full.zip (' + sizeMB + ' MB)');
});

archive.on('error', (err) => {
  console.error('zip-companion-module-mitti-full error:', err);
  process.exit(1);
});
