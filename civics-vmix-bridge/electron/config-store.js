const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function defaultBinding(filter, label) {
  return {
    id: filter,
    enabled: true,
    filter, // top25 | top10 | top5
    label,
    dataSourceName: '',
    tableName: '',
    feedUrl: '',
    /** true = vMix does NOT use first row as column names */
    csvHeaderIsDataRow: false,
    matchColumn: 'state', // state | name
  };
}

function defaultCompanion() {
  return {
    enabled: false,
    host: '127.0.0.1',
    port: 8000,
    /** Companion page number as shown in the GUI (usually 1). */
    page: 1,
    /** 0 = top row. */
    startRow: 0,
    /** 0 = left column. */
    startColumn: 0,
    /** How many buttons sit on one row before wrapping. */
    columns: 10,
    count: 10,
    /** Local URL Companion buttons call to move the vMix row. */
    listenPort: 3921,
  };
}

const DEFAULTS = {
  apiBaseUrl: 'https://ros-50-production.up.railway.app',
  apiToken: '',
  eventId: '',
  vmixHost: '127.0.0.1',
  vmixPort: 8088,
  pollSeconds: 1,
  companion: defaultCompanion(),
  bindings: [
    defaultBinding('top25', 'Top 25'),
    defaultBinding('top10', 'Top 10'),
    defaultBinding('top5', 'Top 5'),
  ],
};

function configPath() {
  return path.join(app.getPath('userData'), 'ros-civics-vmix-config.json');
}

function normalizeBaseUrl(url) {
  let s = String(url || '').trim();
  if (!s) return DEFAULTS.apiBaseUrl;
  s = s.replace(/^(https?):\/(?!\/)/i, '$1://');
  if (!/^https?:\/\//i.test(s)) {
    s = /localhost|127\.0\.0\.1/i.test(s) ? `http://${s}` : `https://${s}`;
  }
  return s.replace(/\/+$/, '').replace(/\/api$/i, '');
}

function normalizeBinding(raw, fallbackFilter) {
  const filter =
    raw?.filter === 'top10' || raw?.filter === 'top5' || raw?.filter === 'top25'
      ? raw.filter
      : fallbackFilter;
  const base = defaultBinding(filter, filter === 'top25' ? 'Top 25' : filter === 'top10' ? 'Top 10' : 'Top 5');
  return {
    ...base,
    ...(raw && typeof raw === 'object' ? raw : {}),
    id: String(raw?.id || filter),
    filter,
    enabled: raw?.enabled !== false,
    label: String(raw?.label || base.label),
    dataSourceName: String(raw?.dataSourceName || raw?.name || '').trim(),
    tableName: String(raw?.tableName || raw?.table || '').trim(),
    feedUrl: String(raw?.feedUrl || '').trim(),
    csvHeaderIsDataRow: raw?.csvHeaderIsDataRow === true,
    matchColumn: raw?.matchColumn === 'name' ? 'name' : 'state',
  };
}

/** Migrate older dataSources{top25:{name,table,feedUrl}} shape → bindings[] */
function migrateLegacy(parsed) {
  if (Array.isArray(parsed.bindings) && parsed.bindings.length) {
    return parsed.bindings.map((b, i) =>
      normalizeBinding(b, ['top25', 'top10', 'top5'][i] || 'top25')
    );
  }
  const ds = parsed.dataSources && typeof parsed.dataSources === 'object' ? parsed.dataSources : {};
  return ['top25', 'top10', 'top5'].map((filter) =>
    normalizeBinding(
      {
        filter,
        dataSourceName: ds[filter]?.name,
        tableName: ds[filter]?.table,
        feedUrl: ds[filter]?.feedUrl,
        csvHeaderIsDataRow: parsed.csvHeaderIsDataRow === true,
      },
      filter
    )
  );
}

function normalizeCompanion(raw) {
  const base = defaultCompanion();
  const src = raw && typeof raw === 'object' ? raw : {};
  const count = Math.min(32, Math.max(1, parseInt(String(src.count), 10) || base.count));
  const columns = Math.min(32, Math.max(1, parseInt(String(src.columns), 10) || base.columns));
  return {
    enabled: src.enabled === true,
    host: String(src.host || base.host).trim() || base.host,
    port: Math.max(1, parseInt(String(src.port), 10) || base.port),
    page: Math.max(1, parseInt(String(src.page), 10) || base.page),
    startRow: Math.max(0, parseInt(String(src.startRow), 10) || 0),
    startColumn: Math.max(0, parseInt(String(src.startColumn), 10) || 0),
    columns,
    count,
    listenPort: Math.max(1, parseInt(String(src.listenPort), 10) || base.listenPort),
  };
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULTS, ...parsed };
    merged.apiBaseUrl = normalizeBaseUrl(merged.apiBaseUrl);
    merged.bindings = migrateLegacy(parsed);
    merged.pollSeconds = Math.max(0.5, Number(merged.pollSeconds) || 1);
    merged.vmixPort = Math.max(1, parseInt(String(merged.vmixPort), 10) || 8088);
    merged.companion = normalizeCompanion(parsed.companion);
    delete merged.dataSources;
    delete merged.csvHeaderIsDataRow;
    return merged;
  } catch {
    return {
      ...DEFAULTS,
      companion: defaultCompanion(),
      bindings: DEFAULTS.bindings.map((b) => ({ ...b })),
    };
  }
}

function saveConfig(cfg) {
  const next = { ...DEFAULTS, ...cfg };
  next.apiBaseUrl = normalizeBaseUrl(next.apiBaseUrl);
  // The window still edits dataSources{top25,top10,top5}. Prefer that over a stale bindings array.
  const source = cfg?.dataSources
    ? { ...cfg, dataSources: cfg.dataSources, bindings: undefined }
    : cfg;
  next.bindings = migrateLegacy(source || {}).map((b, i) =>
    normalizeBinding(b, ['top25', 'top10', 'top5'][i] || 'top25')
  );
  if (cfg?.csvHeaderIsDataRow === true || cfg?.csvHeaderIsDataRow === false) {
    next.bindings = next.bindings.map((b) => ({
      ...b,
      csvHeaderIsDataRow: cfg.csvHeaderIsDataRow === true,
    }));
  }
  next.companion = normalizeCompanion(cfg?.companion);
  next.pollSeconds = Math.max(0.5, Number(next.pollSeconds) || 1);
  next.vmixPort = Math.max(1, parseInt(String(next.vmixPort), 10) || 8088);
  delete next.dataSources;
  delete next.csvHeaderIsDataRow;
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return loadConfig();
}

module.exports = {
  loadConfig,
  saveConfig,
  DEFAULTS,
  normalizeBaseUrl,
  defaultBinding,
  normalizeCompanion,
};
