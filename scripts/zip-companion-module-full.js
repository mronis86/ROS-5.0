/**
 * Create companion-module-runofshow-full.zip including node_modules (~18MB).
 * Zip root must be companion-module-runofshow/ so Companion can discover the module.
 * Run from project root.
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'companion-module-runofshow');
const zipPath = path.join(projectRoot, 'public', 'companion-module-runofshow-full.zip');
const FOLDER = 'companion-module-runofshow';

if (!fs.existsSync(sourcePath)) {
  console.warn('scripts/zip-companion-module-full.js: companion-module-runofshow not found, skipping.');
  process.exit(0);
}

console.log('Installing dependencies in companion-module-runofshow...');
const installCmd = process.env.CI === 'true' ? 'npm ci' : 'npm install';
execSync(installCmd, { cwd: sourcePath, stdio: 'inherit' });

const publicDir = path.dirname(zipPath);
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Write to a temp file first — OneDrive often locks the public/*.zip path.
const tmpZipPath = path.join(
  publicDir,
  `companion-module-runofshow-full.${process.pid}.${Date.now()}.tmp.zip`
);

const archiver = require('archiver');
const output = fs.createWriteStream(tmpZipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

const done = new Promise((resolve, reject) => {
  output.on('close', resolve);
  archive.on('error', reject);
  output.on('error', reject);
});

archive.pipe(output);
// Put everything under companion-module-runofshow/ (required for Companion module discovery).
// `prefix` must be on the entry data (3rd arg), not the glob options.
archive.glob(
  '**/*',
  {
    cwd: sourcePath,
    dot: true,
    ignore: ['.git/**'],
  },
  { prefix: FOLDER }
);
archive.finalize();

done
  .then(() => {
    try {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    } catch (_) {
      /* OneDrive may hold briefly; overwrite next */
    }
    try {
      fs.renameSync(tmpZipPath, zipPath);
    } catch (_) {
      fs.copyFileSync(tmpZipPath, zipPath);
      fs.unlinkSync(tmpZipPath);
    }
    const stat = fs.statSync(zipPath);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
    console.log('Created public/companion-module-runofshow-full.zip (' + sizeMB + ' MB)');
  })
  .catch((err) => {
    try {
      if (fs.existsSync(tmpZipPath)) fs.unlinkSync(tmpZipPath);
    } catch (_) {
      /* ignore */
    }
    console.error('zip-companion-module-full error:', err);
    process.exit(1);
  });
