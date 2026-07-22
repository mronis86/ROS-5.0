'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const uiRoot = path.join(__dirname, '..', 'ui');

function ensureUiDeps() {
  const viteBin = path.join(uiRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  if (fs.existsSync(viteBin)) return viteBin;

  console.log('Installing offline UI dependencies (first time or after update)...');
  execSync('npm install --no-audit --no-fund', { cwd: uiRoot, stdio: 'inherit' });
  if (!fs.existsSync(viteBin)) {
    throw new Error('vite not found after npm install in offline-show/ui');
  }
  return viteBin;
}

console.log('📦 Building offline UI (Tailwind + React)...');
const viteBin = ensureUiDeps();
execSync(`node "${viteBin}" build`, {
  cwd: uiRoot,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});
console.log('✅ Offline UI built → offline-show/ui/dist');
