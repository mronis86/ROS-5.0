const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Packaged portable/dir builds store the token next to the exe (kiosk-data/).
 * A fresh unzip therefore starts with no token. Reusing the same folder keeps it.
 * Dev builds still use Electron userData.
 *
 * Do NOT use the shared %LOCALAPPDATA%\ros-offline-kiosk-v2 path for tokens —
 * that leaked prior-install tokens into every new download on the same machine.
 */
function storeDir() {
  try {
    if (app && app.isPackaged) {
      return path.join(path.dirname(app.getPath('exe')), 'kiosk-data');
    }
  } catch {
    /* fall through */
  }
  return app.getPath('userData');
}

function storePath() {
  return path.join(storeDir(), 'ros-offline-kiosk-token.json');
}

function tokenPrefix(token) {
  if (!token || token.length < 8) return '';
  return token.length <= 12 ? token : `${token.slice(0, 12)}…`;
}

function loadStoredToken() {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    const data = JSON.parse(raw);
    const token = typeof data?.token === 'string' ? data.token.trim() : '';
    if (!token) return { token: '', prefix: '', configured: false };
    return { token, prefix: tokenPrefix(token), configured: true };
  } catch {
    return { token: '', prefix: '', configured: false };
  }
}

function saveStoredToken(token) {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  if (!trimmed) {
    try {
      fs.unlinkSync(storePath());
    } catch {
      /* ignore */
    }
    return { token: '', prefix: '', configured: false };
  }
  fs.writeFileSync(storePath(), JSON.stringify({ token: trimmed }, null, 2), 'utf8');
  return { token: trimmed, prefix: tokenPrefix(trimmed), configured: true };
}

function clearStoredToken() {
  return saveStoredToken('');
}

module.exports = {
  loadStoredToken,
  saveStoredToken,
  clearStoredToken,
  tokenPrefix,
  storePath,
};
