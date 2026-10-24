const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { normalizeBaseUrl, normalizeApiToken } = require('./auth-session');

const DEFAULTS = {
  apiBaseUrl: 'https://ros-50-production.up.railway.app',
  apiToken: '',
  eventId: '',
  bridgeMode: 'follow',
  syncFolder: '',
  liveCaptureSource: 'screen',
  liveCaptureRooms: {},
};

function configPath() {
  return path.join(app.getPath('userData'), 'ros-powerpoint-bridge-config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig(partial) {
  const next = { ...loadConfig(), ...partial };
  if (next.apiBaseUrl) next.apiBaseUrl = normalizeBaseUrl(next.apiBaseUrl);
  if (next.apiToken != null) next.apiToken = normalizeApiToken(next.apiToken);
  if (next.eventId != null) next.eventId = String(next.eventId || '').trim();
  if (next.bridgeMode != null) {
    next.bridgeMode = next.bridgeMode === 'playback' ? 'playback' : 'follow';
  }
  if (next.syncFolder != null) next.syncFolder = String(next.syncFolder || '').trim();
  if (next.liveCaptureSource != null) {
    next.liveCaptureSource = next.liveCaptureSource === 'camera' ? 'camera' : 'screen';
  }
  if (next.liveCaptureRooms != null && typeof next.liveCaptureRooms !== 'object') {
    next.liveCaptureRooms = {};
  }
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { DEFAULTS, loadConfig, saveConfig };
