'use strict';

const fs = require('fs');
const path = require('path');

function stampDay() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function stampTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(
    d.getMilliseconds()
  ).padStart(3, '0')}`;
}

function logsDir() {
  const fromEnv = (process.env.OFFLINE_SHOW_LOG_DIR || '').trim();
  const root = fromEnv || path.join(__dirname, '..', 'data', 'logs');
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch {
    /* ignore */
  }
  return root;
}

function logPath() {
  return path.join(logsDir(), `cloud-${stampDay()}.log`);
}

function cloudLog(level, message, detail) {
  const parts = [`[${stampTime()}] [${level}] ${message}`];
  if (detail != null) {
    try {
      parts.push(typeof detail === 'string' ? detail : JSON.stringify(detail));
    } catch {
      parts.push(String(detail));
    }
  }
  const line = `${parts.join(' ')}\n`;
  const file = logPath();
  try {
    fs.appendFileSync(file, line, 'utf8');
  } catch {
    /* ignore */
  }
  try {
    const fn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
    fn(`[cloud] ${message}`, detail != null ? detail : '');
  } catch {
    /* ignore */
  }
  return file;
}

function readCloudLogTail(maxBytes = 48 * 1024) {
  const file = logPath();
  try {
    if (!fs.existsSync(file)) {
      return { ok: true, path: file, text: '(cloud log empty — run Cloud diagnostics first)' };
    }
    const buf = fs.readFileSync(file);
    const slice = buf.length > maxBytes ? buf.subarray(buf.length - maxBytes) : buf;
    return { ok: true, path: file, text: slice.toString('utf8') };
  } catch (e) {
    return {
      ok: false,
      path: file,
      text: e instanceof Error ? e.message : 'Failed to read cloud log',
    };
  }
}

module.exports = {
  logsDir,
  logPath,
  cloudLog,
  readCloudLogTail,
};
