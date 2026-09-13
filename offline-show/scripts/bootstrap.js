'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const offlineRoot = path.join(__dirname, '..');
const uiDistIndex = path.join(offlineRoot, 'ui', 'dist', 'index.html');
const forceRebuild = process.argv.includes('--rebuild-ui');
const skipUiBuild = process.argv.includes('--skip-ui-build');

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function nodeMajor() {
  const m = /^v?(\d+)/.exec(process.version || '');
  return m ? parseInt(m[1], 10) : 0;
}

console.log('========== Offline Show bootstrap ==========');
console.log(`Node ${process.version} (${process.platform}/${process.arch})`);

const major = nodeMajor();
if (major < 20) {
  console.error('');
  console.error(`Node ${process.version} is too old.`);
  console.error('Offline Show needs Node.js 20 or newer (22 LTS recommended).');
  console.error('Install from https://nodejs.org/ then run this again.');
  process.exit(1);
}

try {
  execSync('npm --version', { stdio: 'pipe' });
} catch {
  console.error('npm is required (ships with Node.js). Reinstall Node from https://nodejs.org/');
  process.exit(1);
}

console.log('Installing offline-show server dependencies...');
try {
  run('npm install --no-audit --no-fund', offlineRoot);
} catch (err) {
  console.error('');
  console.error('npm install failed.');
  console.error('SQLite uses a native module (better-sqlite3). If you see node-gyp / Visual Studio errors:');
  console.error('  • Prefer Node 20–26 with internet so prebuilt binaries can download');
  console.error('  • Or install Node 22 LTS from https://nodejs.org/ (Current/odd majors can lag on prebuilds)');
  console.error('  • Do not need Visual Studio when a matching prebuild exists');
  process.exit(typeof err.status === 'number' ? err.status : 1);
}

const needsUiBuild = forceRebuild || !fs.existsSync(uiDistIndex);

if (needsUiBuild) {
  if (skipUiBuild) {
    console.error('❌ ui/dist/index.html missing. Re-download offline-show.zip or run without --skip-ui-build.');
    process.exit(1);
  }
  require('./build-ui.js');
} else {
  console.log('✅ Using pre-built UI in ui/dist (pass --rebuild-ui to rebuild from source)');
}

console.log('========== Bootstrap complete ==========');
