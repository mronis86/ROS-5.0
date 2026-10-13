const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function defaultShortStateNamesText() {
  return [
    'District of Columbia = DC',
    'American Samoa = AS',
    'Guam = GU',
    'Northern Mariana Islands = MP',
    'Puerto Rico = PR',
    'U.S. Virgin Islands = VI',
  ].join('\n');
}

function defaultCompanion() {
  return {
    enabled: true,
    host: '10.162.4.100',
    port: 8888,
    page: 1,
    firstBank: 1,
    startRow: 0,
    startColumn: 0,
    columns: 5,
    count: 10,
    apiVersion: 'v2',
    buttonImages: true,
    pictureFolder: '',
    pictureStyle: 'abbrev-name',
    useShortStateNames: false,
    shortStateNames: defaultShortStateNamesText(),
    flagOutline: false,
    bgStillIn: '#000000',
    bgEliminated: '#000000',
    pressColors: false,
    pressListenPort: 3921,
    pressSelectedColor: '#2563eb',
    pressDefaultColor: '#000000',
  };
}

function hexColor(value, fallback) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  return fallback;
}

function pictureStyleOf(src) {
  const allowed = ['abbrev-name', 'abbrev-name-flag', 'state-name', 'flag-state-name', 'state-student', 'flag-state-student', 'state-initial', 'flag-state-initial'];
  if (allowed.includes(src.pictureStyle)) return src.pictureStyle;
  return 'abbrev-name';
}

function pictureFolderOf(value) {
  let raw = String(value || '').trim().replace(/^["']|["']$/g, '');
  if (!raw || /[\r\n]/.test(raw)) return '';
  raw = path.normalize(raw);
  if (!path.isAbsolute(raw)) return '';
  return raw;
}

function normalizeCompanion(raw) {
  const base = defaultCompanion();
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: src.enabled !== false,
    host: String(src.host || base.host).trim() || base.host,
    port: Math.max(1, parseInt(String(src.port), 10) || base.port),
    page: Math.max(1, parseInt(String(src.page), 10) || base.page),
    startRow: Math.max(0, parseInt(String(src.startRow), 10) || 0),
    startColumn: Math.max(0, parseInt(String(src.startColumn), 10) || 0),
    columns: Math.min(32, Math.max(1, parseInt(String(src.columns), 10) || base.columns)),
    count: Math.min(32, Math.max(1, parseInt(String(src.count), 10) || base.count)),
    apiVersion: src.apiVersion === 'v3' ? 'v3' : 'v2',
    firstBank: Math.max(1, parseInt(String(src.firstBank), 10) || 1),
    buttonImages: src.buttonImages !== false,
    pictureFolder: pictureFolderOf(src.pictureFolder),
    pictureStyle: pictureStyleOf(src),
    useShortStateNames: src.useShortStateNames === true,
    shortStateNames: typeof src.shortStateNames === 'string' ? src.shortStateNames : base.shortStateNames,
    flagOutline: src.flagOutline === true,
    bgStillIn: hexColor(src.bgStillIn, base.bgStillIn),
    bgEliminated: hexColor(src.bgEliminated, base.bgEliminated),
    pressColors: src.pressColors === true,
    pressListenPort: Math.min(65535, Math.max(1, parseInt(String(src.pressListenPort), 10) || base.pressListenPort)),
    pressSelectedColor: hexColor(src.pressSelectedColor, base.pressSelectedColor),
    pressDefaultColor: hexColor(src.pressDefaultColor, base.pressDefaultColor),
  };
}

function parseShortStateNames(text) {
  const map = new Map();
  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      const eq = trimmed.indexOf('=');
      if (eq <= 0) return;
      const full = trimmed.slice(0, eq).trim();
      const shortName = trimmed.slice(eq + 1).trim();
      if (full && shortName) map.set(full.toLowerCase(), shortName);
    });
  return map;
}

function stateLabelFor(state, companion) {
  const full = String(state || '').trim();
  if (!companion?.useShortStateNames) return full;
  return parseShortStateNames(companion.shortStateNames).get(full.toLowerCase()) || full;
}

const DEFAULTS = {
  apiBaseUrl: 'https://ros-50-production.up.railway.app',
  eventId: '',
  pollSeconds: 2,
  companion: defaultCompanion(),
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
      pollSeconds: Math.max(1, Number(parsed.pollSeconds) || 2),
      companion: normalizeCompanion(parsed.companion),
    };
  } catch {
    return { ...DEFAULTS, companion: defaultCompanion() };
  }
}

function saveConfig(cfg) {
  const next = {
    apiBaseUrl: normalizeBaseUrl(cfg?.apiBaseUrl),
    eventId: String(cfg?.eventId || '').trim(),
    pollSeconds: Math.max(1, Number(cfg?.pollSeconds) || 2),
    companion: normalizeCompanion(cfg?.companion),
  };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { loadConfig, saveConfig, normalizeBaseUrl, stateLabelFor, defaultShortStateNamesText };
