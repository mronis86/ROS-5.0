const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  apiBaseUrl: 'https://ros-50-production.up.railway.app',
  eventId: '',
  pictureFolder: '',
  pollSeconds: 2,
};

function configPath() {
  return path.join(app.getPath('userData'), 'civics-bridge-v2-config.json');
}

function normalizeBaseUrl(url) {
  let s = String(url || '').trim();
  if (!s) return DEFAULTS.apiBaseUrl;
  s = s.replace(/^(https?):\/(?!\/)/i, '$1://');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, '').replace(/\/api$/i, '');
}

function loadConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return {
      apiBaseUrl: normalizeBaseUrl(parsed.apiBaseUrl),
      eventId: String(parsed.eventId || '').trim(),
      pictureFolder: String(parsed.pictureFolder || '').trim(),
      pollSeconds: Math.max(1, Number(parsed.pollSeconds) || 2),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig(cfg) {
  const next = {
    apiBaseUrl: normalizeBaseUrl(cfg?.apiBaseUrl),
    eventId: String(cfg?.eventId || '').trim(),
    pictureFolder: String(cfg?.pictureFolder || '').trim(),
    pollSeconds: Math.max(1, Number(cfg?.pollSeconds) || 2),
  };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { loadConfig, saveConfig, normalizeBaseUrl };
