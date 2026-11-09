/**
 * Zip offline-kiosk-v2/ → public/offline-kiosk-v2.zip (fetched by install-offline-kiosk.bat).
 * Operators download the .bat from the site, not this zip.
 * Omits node_modules and WebLinked binary payload (~390MB).
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const archiver = require('archiver');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, 'offline-kiosk-v2');
const zipPath = path.join(projectRoot, 'public', 'offline-kiosk-v2.zip');
const buildUiScript = path.join(sourcePath, 'engines', 'offline-show', 'scripts', 'build-ui.js');
const prefix = 'offline-kiosk-v2';

function shouldSkip(relPosix) {
  const rel = relPosix.replace(/\\/g, '/');
  if (rel.includes('/node_modules/') || rel.startsWith('node_modules/')) return true;
  // Only skip Electron pack output at repo root — keep engines/.../ui/dist
  if (rel === 'dist' || rel.startsWith('dist/')) return true;
  if (rel.includes('/data/') || /(^|\/)data\//.test(rel)) return true;
  if (/\.db(-shm|-wal)?$/i.test(rel)) return true;
  if (rel === 'engines/weblinked' || rel.startsWith('engines/weblinked/')) return true;
  if (/\.zip$/i.test(rel) || /\.log$/i.test(rel)) return true;
  return false;
}

if (!fs.existsSync(sourcePath)) {
  console.warn('scripts/zip-offline-kiosk.js: offline-kiosk-v2 not found, skipping.');
  process.exit(0);
}

if (fs.existsSync(buildUiScript)) {
  console.log('Building offline-kiosk Offline Show UI for zip...');
  try {
    execSync(`node "${buildUiScript}"`, { cwd: projectRoot, stdio: 'inherit' });
  } catch (err) {
    console.warn('zip-offline-kiosk: UI build failed; zipping without fresh ui/dist.', err.message || err);
  }
}

const publicDir = path.dirname(zipPath);
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

const startBat = `@echo off
setlocal
cd /d "%~dp0"
if not exist "launcher\\start-offline-kiosk.bat" (
  echo ERROR: Unzip the full offline-kiosk-v2 folder first.
  pause
  exit /b 1
)
call "launcher\\start-offline-kiosk.bat"
endlocal
`;

const readme = `ROS Offline Kiosk V2 (package used by install-offline-kiosk.bat)

Preferred: download install-offline-kiosk.bat from ROS and run it.
It installs this package under %LOCALAPPDATA%\\ROS-Offline-Kiosk if needed.

Manual:
1. Unzip this folder.
2. Double-click START.bat (Node.js 20+ required).
3. Optional WebLinked: npm run sync:weblinked
`;

const output = fs.createWriteStream(zipPath);
output.on('error', (err) => {
  console.warn(`Skipping offline-kiosk zip rewrite (${err.message}). Keeping the existing file.`);
  process.exit(0);
});
const archive = archiver('zip', { zlib: { level: 9 } });
archive.on('error', (err) => {
  console.error('zip-offline-kiosk error:', err);
  process.exit(1);
});
archive.pipe(output);

archive.append(startBat, { name: `${prefix}/START.bat` });
archive.append(readme, { name: `${prefix}/README-DOWNLOAD.txt` });

function walk(dir, baseRel = '') {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = baseRel ? `${baseRel}/${name}` : name;
    const relPosix = rel.replace(/\\/g, '/');
    if (shouldSkip(relPosix)) continue;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      walk(abs, relPosix);
      continue;
    }
    archive.file(abs, { name: `${prefix}/${relPosix}` });
  }
}

walk(sourcePath);

for (const name of ['README.md', '.gitkeep', 'BUNDLE.txt']) {
  const p = path.join(sourcePath, 'engines', 'weblinked', name);
  if (fs.existsSync(p)) {
    archive.file(p, { name: `${prefix}/engines/weblinked/${name}` });
  }
}

archive.finalize();

output.on('close', () => {
  const mb = (archive.pointer() / (1024 * 1024)).toFixed(1);
  console.log(`Created public/${path.basename(zipPath)} (${mb} MB)`);
  const installSrc = path.join(sourcePath, 'launcher', 'install-offline-kiosk.bat');
  const installDest = path.join(publicDir, 'install-offline-kiosk.bat');
  if (fs.existsSync(installSrc)) {
    try {
      fs.copyFileSync(installSrc, installDest);
      console.log('Updated public/install-offline-kiosk.bat');
    } catch (err) {
      console.warn(`Could not update install-offline-kiosk.bat (${err.message})`);
    }
  }
});
