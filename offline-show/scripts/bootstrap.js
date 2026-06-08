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

console.log('========== Offline Show bootstrap ==========');

try {
  execSync('node --version', { stdio: 'pipe' });
} catch {
  console.error('Node.js is required. Install from https://nodejs.org/ then run this again.');
  process.exit(1);
}

console.log('Installing offline-show server dependencies...');
run('npm install', offlineRoot);

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
