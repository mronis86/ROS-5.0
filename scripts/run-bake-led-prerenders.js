/**
 * Launcher: runs spout-bridge Electron against bake-led-prerenders.js
 * Pass-through args: --eventId= --token= --appUrl= --apiUrl= --out= …
 */
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const spoutRoot = path.join(projectRoot, 'spout-bridge');
const bakeScript = path.join(spoutRoot, 'scripts', 'bake-led-prerenders.js');

let electronPath;
try {
  electronPath = require(path.join(spoutRoot, 'node_modules', 'electron'));
} catch {
  console.error('Electron not found in spout-bridge. Run: cd spout-bridge && npm install');
  process.exit(1);
}

if (!fs.existsSync(bakeScript)) {
  console.error('Bake script missing:', bakeScript);
  process.exit(1);
}

const child = spawn(electronPath, [bakeScript, ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 1));
