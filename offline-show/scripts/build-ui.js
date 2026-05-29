'use strict';

const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const uiRoot = path.join(__dirname, '..', 'ui');
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');

console.log('📦 Building offline UI (Tailwind + React)...');
execSync(`node "${viteBin}" build`, {
  cwd: uiRoot,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});
console.log('✅ Offline UI built → offline-show/ui/dist');
