const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { normalizeBaseUrl } = require('./auth-session');

const DEFAULT_BINDING = {
  id: 'default',
  enabled: true,
  label: '',
  dataSourceName: '',
  tableName: '',
  matchMode: 'cueColumn',
  cueColumn: 'cue',
  dayFilter: null,
};

const DEFAULTS = {
  apiBaseUrl: 'https://ros-50-production.up.railway.app',
  apiToken: '',
  eventId: '',
  vmixHost: '127.0.0.1',
  vmixPort: 8088,
  pollSeconds: 5,
  bindings: [{ ...DEFAULT_BINDING }],
};

function configPath() {
  return path.join(app.getPath('userData'), 'ros-vmix-datasource-config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULTS, ...parsed };
    if (!Array.isArray(merged.bindings) || merged.bindings.length === 0) {
      merged.bindings = [{ ...DEFAULT_BINDING }];
    } else {
      merged.bindings = merged.bindings.map((b, i) => ({
        ...DEFAULT_BINDING,
        ...b,
        id: b.id || `b${i + 1}`,
        enabled: b.enabled !== false,
      }));
    }
    return merged;
  } catch {
    return {
      ...DEFAULTS,
      bindings: [{ ...DEFAULT_BINDING }],
    };
  }
}

function saveConfig(partial) {
  const next = { ...loadConfig(), ...partial };
  if (next.apiBaseUrl) next.apiBaseUrl = normalizeBaseUrl(next.apiBaseUrl);
  if (next.vmixHost) next.vmixHost = String(next.vmixHost).trim();
  next.vmixPort = Math.max(1, parseInt(String(next.vmixPort || 8088), 10) || 8088);
  next.pollSeconds = Math.max(2, parseInt(String(next.pollSeconds || 5), 10) || 5);
  next.bindings = next.bindings.map((b, i) => ({
    ...DEFAULT_BINDING,
    ...b,
    id: b.id || `b${i + 1}`,
    enabled: b.enabled !== false,
    label: String(b.label || '').trim(),
    dataSourceName: String(b.dataSourceName || '').trim(),
    tableName: String(b.tableName || '').trim(),
    matchMode: b.matchMode === 'rowIndex' ? 'rowIndex' : 'cueColumn',
    cueColumn: String(b.cueColumn || 'cue').trim() || 'cue',
    dayFilter:
      b.dayFilter === '' || b.dayFilter == null || Number.isNaN(Number(b.dayFilter))
        ? null
        : Number(b.dayFilter),
  }));
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { DEFAULTS, DEFAULT_BINDING, loadConfig, saveConfig };
