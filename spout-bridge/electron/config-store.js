const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  apiBaseUrl: 'https://ros-50-production.up.railway.app',
  appBaseUrl: '',
  apiToken: '',
  eventId: '',
  spoutName: 'ROS LED',
  width: 1920,
  height: 1080,
  fps: 60,
};

function configPath() {
  return path.join(app.getPath('userData'), 'ros-led-spout-config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig(partial) {
  const next = { ...loadConfig(), ...partial };
  if (next.appBaseUrl) {
    next.appBaseUrl = require('./auth-session').normalizeBaseUrl(next.appBaseUrl);
  }
  if (next.apiBaseUrl) {
    next.apiBaseUrl = require('./auth-session').normalizeBaseUrl(next.apiBaseUrl);
  }
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { DEFAULTS, loadConfig, saveConfig };
