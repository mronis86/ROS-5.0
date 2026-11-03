const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
  selectedDay: 1,
  selectedDaysByEvent: {},
  helperInstanceId: '',
  /** After open/swap: 'off' | 'presentation' (slideshow) | 'app' (PowerPoint window). */
  focusTarget: 'off',
};

function configPath() {
  return path.join(app.getPath('userData'), 'ros-powerpoint-bridge-config.json');
}

function loadConfig() {
  let cfg;
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    cfg = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    cfg = { ...DEFAULTS };
  }
  if (!String(cfg.helperInstanceId || '').trim()) {
    cfg.helperInstanceId = crypto.randomUUID();
    try {
      fs.mkdirSync(path.dirname(configPath()), { recursive: true });
      fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
    } catch {
      /* keep in-memory id for this process */
    }
  }
  return cfg;
}

function saveConfig(partial) {
  const next = { ...loadConfig(), ...partial };
  if (!String(next.helperInstanceId || '').trim()) {
    next.helperInstanceId = crypto.randomUUID();
  }
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
  {
    const raw = String(next.focusTarget || '').trim().toLowerCase();
    if (raw === 'presentation' || raw === 'app' || raw === 'off') {
      next.focusTarget = raw;
    } else if (next.focusPresentationView === true) {
      next.focusTarget = 'presentation';
    } else {
      next.focusTarget = 'off';
    }
    delete next.focusPresentationView;
  }
  const day = Math.floor(Number(next.selectedDay) || 1);
  next.selectedDay = day >= 1 ? day : 1;
  if (next.selectedDaysByEvent == null || typeof next.selectedDaysByEvent !== 'object') {
    next.selectedDaysByEvent = {};
  }
  if (next.eventId) {
    next.selectedDaysByEvent[next.eventId] = next.selectedDay;
  }
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { DEFAULTS, loadConfig, saveConfig };
