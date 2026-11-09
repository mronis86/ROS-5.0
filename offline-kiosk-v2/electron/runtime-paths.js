/**
 * Resolve bundled Offline Show / WebLinked / Node paths in dev vs portable build.
 */
const path = require('path');
const fs = require('fs');

function getElectronApp() {
  try {
    // eslint-disable-next-line global-require
    return require('electron').app;
  } catch {
    return null;
  }
}

function isPackaged() {
  const app = getElectronApp();
  return Boolean(app && app.isPackaged);
}

/** Kiosk project root in dev; resources/ next to the portable exe when packaged. */
function resourcesRoot() {
  if (isPackaged()) {
    return process.resourcesPath;
  }
  return path.resolve(__dirname, '..');
}

function offlineShowRoot() {
  const bundled = path.join(resourcesRoot(), 'engines', 'offline-show');
  if (fs.existsSync(path.join(bundled, 'server', 'server.js'))) return bundled;
  // Dev fallback: sibling ROS-5.0/offline-show
  return path.resolve(__dirname, '..', '..', 'offline-show');
}

function weblinkedRoot() {
  return path.join(resourcesRoot(), 'engines', 'weblinked');
}

/** Prefer portable Node next to resources; else system node on PATH. */
function bundledNodeExe() {
  const candidates = [
    path.join(resourcesRoot(), 'node', 'node.exe'),
    path.join(resourcesRoot(), 'node', 'bin', 'node.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function nodeCommand() {
  return bundledNodeExe() || 'node';
}

module.exports = {
  isPackaged,
  resourcesRoot,
  offlineShowRoot,
  weblinkedRoot,
  bundledNodeExe,
  nodeCommand,
};
