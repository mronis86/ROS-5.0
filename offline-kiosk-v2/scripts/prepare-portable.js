/**
 * Prepare Offline Kiosk portable payload:
 * - Trim WebLinked locales to en-US (saves ~48MB)
 * - Ensure Offline Show deps + UI dist
 * - Download portable Node win-x64 into portable-runtime/node
 *
 * Usage: node scripts/prepare-portable.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const https = require('https');
const { execFileSync, execSync } = require('child_process');

const kioskRoot = path.resolve(__dirname, '..');
const weblinkedRoot = path.join(kioskRoot, 'engines', 'weblinked');
const offlineShowRoot = path.join(kioskRoot, 'engines', 'offline-show');
const runtimeRoot = path.join(kioskRoot, 'portable-runtime');
const nodeRoot = path.join(runtimeRoot, 'node');

const NODE_VERSION = process.env.ROS_KIOSK_NODE_VERSION || '22.17.0';
const NODE_ZIP = `node-v${NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}`;

function log(msg) {
  console.log(msg);
}

function trimWeblinkedLocales() {
  const localesDir = path.join(weblinkedRoot, 'locales');
  if (!fs.existsSync(localesDir)) {
    log('No WebLinked locales/ — skip trim');
    return;
  }
  let removed = 0;
  for (const name of fs.readdirSync(localesDir)) {
    if (name === 'en-US.pak' || name.startsWith('en-US_')) continue;
    fs.unlinkSync(path.join(localesDir, name));
    removed += 1;
  }
  // Drop duplicate stock exe if Sinor is present
  const sinor = path.join(weblinkedRoot, 'sinor-weblinked.exe');
  const stock = path.join(weblinkedRoot, 'weblinked.exe');
  if (fs.existsSync(sinor) && fs.existsSync(stock)) {
    fs.unlinkSync(stock);
    log('Removed duplicate weblinked.exe (keeping sinor-weblinked.exe)');
  }
  log(`Trimmed WebLinked locales (removed ${removed} non en-US packs)`);
}

function ensureWeblinkedPresent() {
  const exe = path.join(weblinkedRoot, 'sinor-weblinked.exe');
  const alt = path.join(weblinkedRoot, 'weblinked.exe');
  if (!fs.existsSync(exe) && !fs.existsSync(alt)) {
    throw new Error(
      'engines/weblinked missing sinor-weblinked.exe. Run: npm run sync:weblinked'
    );
  }
  const libcef = path.join(weblinkedRoot, 'libcef.dll');
  if (!fs.existsSync(libcef)) {
    throw new Error('engines/weblinked missing libcef.dll — sync incomplete.');
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      })
      .on('error', (err) => {
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        reject(err);
      });
  });
}

function ensurePortableNode() {
  const nodeExe = path.join(nodeRoot, 'node.exe');
  if (fs.existsSync(nodeExe)) {
    log(`Portable Node already present: ${nodeExe}`);
    return nodeExe;
  }
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const zipPath = path.join(runtimeRoot, NODE_ZIP);
  log(`Downloading ${NODE_URL} ...`);
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Invoke-WebRequest -Uri '${NODE_URL}' -OutFile '${zipPath}' -UseBasicParsing`,
    ],
    { stdio: 'inherit' }
  );
  const extractDir = path.join(runtimeRoot, `node-v${NODE_VERSION}-win-x64`);
  if (fs.existsSync(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  if (fs.existsSync(nodeRoot)) {
    fs.rmSync(nodeRoot, { recursive: true, force: true });
  }
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${runtimeRoot}' -Force`,
    ],
    { stdio: 'inherit' }
  );
  fs.renameSync(extractDir, nodeRoot);
  try {
    fs.unlinkSync(zipPath);
  } catch {
    /* ignore */
  }
  if (!fs.existsSync(nodeExe)) {
    throw new Error(`node.exe missing after extract: ${nodeExe}`);
  }
  log(`Portable Node ready: ${nodeExe}`);
  return nodeExe;
}

function ensureOfflineShow(nodeExe) {
  if (!fs.existsSync(path.join(offlineShowRoot, 'package.json'))) {
    throw new Error('engines/offline-show missing — run npm run sync:offline-show');
  }
  const npmCmd = path.join(path.dirname(nodeExe), 'npm.cmd');
  log('Installing Offline Show dependencies with portable Node...');
  execSync(`"${npmCmd}" install --no-audit --no-fund`, {
    cwd: offlineShowRoot,
    stdio: 'inherit',
    env: { ...process.env, npm_config_fund: 'false' },
  });
  const uiDist = path.join(offlineShowRoot, 'ui', 'dist', 'index.html');
  const uiNodeModules = path.join(offlineShowRoot, 'ui', 'node_modules');
  if (!fs.existsSync(uiDist)) {
    log('Building Offline Show UI...');
    execSync(`"${nodeExe}" scripts/build-ui.js`, {
      cwd: offlineShowRoot,
      stdio: 'inherit',
    });
  } else {
    log('Offline Show UI dist present');
  }
  // UI build deps are not needed at runtime — drop before packaging (~80MB).
  if (fs.existsSync(uiNodeModules)) {
    log('Removing engines/offline-show/ui/node_modules (build-only)...');
    fs.rmSync(uiNodeModules, { recursive: true, force: true });
  }
  // Prove better-sqlite3 loads on this Node
  execSync(`"${nodeExe}" -e "require('better-sqlite3'); console.log('better-sqlite3 OK')"`, {
    cwd: offlineShowRoot,
    stdio: 'inherit',
  });
}

function folderMb(dir) {
  let total = 0;
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else total += st.size;
    }
  }
  walk(dir);
  return (total / (1024 * 1024)).toFixed(1);
}

async function main() {
  log('========== Prepare portable Offline Kiosk ==========');
  ensureWeblinkedPresent();
  trimWeblinkedLocales();
  const nodeExe = ensurePortableNode();
  ensureOfflineShow(nodeExe);
  log('');
  log(`WebLinked:     ${folderMb(weblinkedRoot)} MB`);
  log(`Offline Show:  ${folderMb(offlineShowRoot)} MB`);
  log(`Portable Node: ${folderMb(nodeRoot)} MB`);
  log('Done. Next: npm run dist');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
