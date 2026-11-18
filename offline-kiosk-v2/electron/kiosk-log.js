/**
 * File logger for Offline Kiosk (WebLinked + cloud diagnostics).
 * Packaged: <exe-dir>/kiosk-data/logs/
 * Dev: %LOCALAPPDATA%\ros-offline-kiosk-v4\logs\
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

let packagedLogsRoot = null;

function setPackagedLogsRoot(dir) {
  if (dir && typeof dir === 'string') packagedLogsRoot = dir;
}

function logsDir() {
  let root;
  if (packagedLogsRoot) {
    root = packagedLogsRoot;
  } else {
    try {
      const { app } = require('electron');
      if (app && app.isPackaged) {
        root = path.join(path.dirname(app.getPath('exe')), 'kiosk-data', 'logs');
      }
    } catch {
      /* fall through */
    }
  }
  if (!root) {
    root = path.join(
      process.env.LOCALAPPDATA || os.tmpdir(),
      'ros-offline-kiosk-v4',
      'logs'
    );
  }
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch {
    /* ignore */
  }
  return root;
}

function stampDay() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function stampTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function logPath(channel = 'weblinked') {
  return path.join(logsDir(), `${channel}-${stampDay()}.log`);
}

function appendLog(channel, level, message, detail) {
  const lineParts = [`[${stampTime()}] [${level}] ${message}`];
  if (detail != null) {
    try {
      lineParts.push(
        typeof detail === 'string' ? detail : JSON.stringify(detail, null, 0)
      );
    } catch {
      lineParts.push(String(detail));
    }
  }
  const line = `${lineParts.join(' ')}\n`;
  const file = logPath(channel);
  try {
    fs.appendFileSync(file, line, 'utf8');
  } catch {
    /* ignore disk errors */
  }
  return file;
}

function wlLog(message, detail) {
  return appendLog('weblinked', 'INFO', message, detail);
}

function wlWarn(message, detail) {
  return appendLog('weblinked', 'WARN', message, detail);
}

function wlError(message, detail) {
  return appendLog('weblinked', 'ERROR', message, detail);
}

function cloudLog(message, detail) {
  return appendLog('cloud', 'INFO', message, detail);
}

function cloudWarn(message, detail) {
  return appendLog('cloud', 'WARN', message, detail);
}

function cloudError(message, detail) {
  return appendLog('cloud', 'ERROR', message, detail);
}

function readTail(channel = 'weblinked', maxBytes = 24 * 1024) {
  const file = logPath(channel);
  try {
    if (!fs.existsSync(file)) return { ok: true, path: file, text: '(log empty — nothing written yet)' };
    const buf = fs.readFileSync(file);
    const slice = buf.length > maxBytes ? buf.subarray(buf.length - maxBytes) : buf;
    return { ok: true, path: file, text: slice.toString('utf8') };
  } catch (e) {
    return {
      ok: false,
      path: file,
      text: e instanceof Error ? e.message : 'Failed to read log',
    };
  }
}

module.exports = {
  setPackagedLogsRoot,
  logsDir,
  logPath,
  wlLog,
  wlWarn,
  wlError,
  cloudLog,
  cloudWarn,
  cloudError,
  readTail,
  appendLog,
};
