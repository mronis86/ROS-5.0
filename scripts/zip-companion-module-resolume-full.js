/**
 * Create companion-module-runofshow-resolume-full.zip including node_modules.
 * Run from project root. Served from OSC Control modal download.
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'companion-module-runofshow-resolume');
const zipPath = path.join(projectRoot, 'public', 'companion-module-runofshow-resolume-full.zip');

if (!fs.existsSync(sourcePath)) {
  console.warn('scripts/zip-companion-module-resolume-full.js: companion-module-runofshow-resolume not found, skipping.');
  process.exit(0);
}

console.log('Installing dependencies in companion-module-runofshow-resolume...');
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
  prefix: 'companion-module-runofshow-resolume'
});
archive.finalize();

output.on('close', () => {
  const stat = fs.statSync(zipPath);
  const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
  console.log('Created public/companion-module-runofshow-resolume-full.zip (' + sizeMB + ' MB)');
});

archive.on('error', (err) => {
  console.error('zip-companion-module-resolume-full error:', err);
  process.exit(1);
});
