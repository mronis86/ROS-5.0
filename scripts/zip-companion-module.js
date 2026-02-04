/**
 * Zip companion-module-runofshow to public/companion-module-runofshow.zip
 * Excludes node_modules and .git. Cross-platform (runs in Netlify/Linux builds).
 */
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'companion-module-runofshow');
const zipPath = path.join(projectRoot, 'public', 'companion-module-runofshow.zip');

if (!fs.existsSync(sourcePath)) {
  console.warn('scripts/zip-companion-module.js: companion-module-runofshow not found, skipping.');
  process.exit(0);
}

const archiver = require('archiver');

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
  ignore: ['node_modules/**', '.git/**'],
  prefix: 'companion-module-runofshow'
});
archive.finalize();

output.on('close', () => {
  console.log('Created public/companion-module-runofshow.zip');
});

archive.on('error', (err) => {
  console.error('zip-companion-module error:', err);
  process.exit(1);
});
