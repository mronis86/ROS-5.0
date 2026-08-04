const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { normalizeBaseUrl, normalizeApiToken } = require('./auth-session');

const DEFAULT_BINDING = {
  id: 'default',
  enabled: true,
  label: '',
  dataSourceName: '',
  tableName: '',
  /** Same CSV/XML URL pasted into vMix Data Sources (supports ?day=N). */
  feedUrl: '',
  matchMode: 'cueColumn',
  cueColumn: 'cue',
  dayFilter: null,
  /**
   * vMix Excel/CSV option "Use first row as column names".
   * When true (default), DataSourceSelectRow 0 = first data row.
   * When false, row 0 is the header line — we offset accordingly.
   * XML feeds ignore this (no header row).
   */
  vmixUsesHeaderRow: true,
};

const DEFAULTS = {
  apiBaseUrl: 'https://ros-50-production.up.railway.app',
  apiToken: '',
  eventId: '',
  vmixHost: '127.0.0.1',
  vmixPort: 8088,
  pollSeconds: 1,
  /** Last auto-stop choice shown in the Start modal (cost guard). */
  autoStopHours: 2,
  autoStopMinutes: 0,
  autoStopNever: false,
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
  if (next.apiToken != null) next.apiToken = normalizeApiToken(next.apiToken);
  if (next.vmixHost) next.vmixHost = String(next.vmixHost).trim();
  next.vmixPort = Math.max(1, parseInt(String(next.vmixPort || 8088), 10) || 8088);
  next.pollSeconds = Math.min(60, Math.max(1, parseInt(String(next.pollSeconds || 1), 10) || 1));
  next.autoStopHours = Math.min(24, Math.max(0, parseInt(String(next.autoStopHours ?? 2), 10) || 0));
  next.autoStopMinutes = [0, 5, 10, 15, 20, 25, 30, 45].includes(Number(next.autoStopMinutes))
    ? Number(next.autoStopMinutes)
    : 0;
  next.autoStopNever = next.autoStopNever === true;
  next.bindings = next.bindings.map((b, i) => ({
    ...DEFAULT_BINDING,
    ...b,
    id: b.id || `b${i + 1}`,
    enabled: b.enabled !== false,
    label: String(b.label || '').trim(),
    dataSourceName: String(b.dataSourceName || '').trim(),
    tableName: String(b.tableName || '').trim(),
    matchMode: b.matchMode === 'rowIndex' ? 'rowIndex' : 'cueColumn',
    feedUrl: String(b.feedUrl || '').trim(),
    cueColumn: String(b.cueColumn || 'cue').trim() || 'cue',
    dayFilter:
      b.dayFilter === '' || b.dayFilter == null || Number.isNaN(Number(b.dayFilter))
        ? null
        : Number(b.dayFilter),
    vmixUsesHeaderRow: b.vmixUsesHeaderRow !== false,
  }));
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { DEFAULTS, DEFAULT_BINDING, loadConfig, saveConfig };
