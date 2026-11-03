/**
 * Zip companion-module-runofshow to public/companion-module-runofshow.zip
 * Excludes node_modules and .git. Zip root must be companion-module-runofshow/.
 */
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'companion-module-runofshow');
const zipPath = path.join(projectRoot, 'public', 'companion-module-runofshow.zip');
const FOLDER = 'companion-module-runofshow';

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

const done = new Promise((resolve, reject) => {
  output.on('close', resolve);
  archive.on('error', reject);
  output.on('error', reject);
});

archive.pipe(output);
archive.glob(
  '**/*',
  {
    cwd: sourcePath,
    dot: false,
    ignore: ['node_modules/**', '.git/**'],
  },
  { prefix: FOLDER }
);
archive.finalize();

done
  .then(() => {
    console.log('Created public/companion-module-runofshow.zip');
  })
  .catch((err) => {
    console.error('zip-companion-module error:', err);
    process.exit(1);
  });
