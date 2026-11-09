const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { clampLiveHours } = require('./session-schedule');

const DEFAULTS = {
  sessionMode: '',
  sessionHours: 4,
  sessionEndsAt: '',
  sessionLabel: '',
};

function storePath() {
  return path.join(app.getPath('userData'), 'ros-offline-kiosk-session.json');
}

function loadSessionConfig() {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSessionConfig(partial) {
  const next = { ...loadSessionConfig(), ...partial };
  const mode = String(next.sessionMode || '').trim().toLowerCase();
  next.sessionMode =
    mode === 'testing' || mode === 'live' || mode === 'everyday' ? mode : '';
  next.sessionHours = clampLiveHours(next.sessionHours);
  next.sessionEndsAt = String(next.sessionEndsAt || '').trim();
  next.sessionLabel = String(next.sessionLabel || '').trim();
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { loadSessionConfig, saveSessionConfig };
