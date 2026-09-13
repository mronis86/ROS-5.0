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

/** Ensure better-sqlite3 native binding actually loads (npm may skip install scripts). */
function ensureSqliteBinding() {
  try {
    require(path.join(offlineRoot, 'node_modules', 'better-sqlite3'));
    console.log('✅ better-sqlite3 native binding OK');
    return;
  } catch (err) {
    console.warn('⚠️ better-sqlite3 binding missing — rebuilding...');
    console.warn(String(err && err.message ? err.message : err));
  }

  try {
    // Project allowScripts in package.json permits this on npm 12+ (do not pass --allow-scripts).
    run('npm rebuild better-sqlite3', offlineRoot);
    require(path.join(offlineRoot, 'node_modules', 'better-sqlite3'));
    console.log('✅ better-sqlite3 rebuilt successfully');
  } catch (err) {
    console.error('');
    console.error('SQLite native module failed to load after rebuild.');
    console.error('Confirm package.json has: "allowScripts": { "better-sqlite3": true }');
    console.error('Then run: npm rebuild better-sqlite3');
    console.error('');
    console.error(String(err && err.message ? err.message : err));
    process.exit(1);
  }
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
  // npm 12+ uses package.json "allowScripts" for project installs — never --allow-scripts here
  // (that flag is only for global / npx and causes EALLOWSCRIPTS in a project).
  run('npm install --no-audit --no-fund', offlineRoot);
} catch (err) {
  console.error('');
  console.error('npm install failed.');
  console.error('SQLite uses a native module (better-sqlite3). If you see node-gyp / Visual Studio errors:');
  console.error('  • Prefer Node 20–26 with internet so prebuilt binaries can download');
  console.error('  • Or install Node 22 LTS from https://nodejs.org/');
  console.error('  • Ensure package.json allowScripts includes better-sqlite3');
  process.exit(typeof err.status === 'number' ? err.status : 1);
}

ensureSqliteBinding();

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
