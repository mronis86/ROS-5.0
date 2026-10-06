const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  apiBaseUrl: 'https://ros-50-production.up.railway.app',
  apiToken: '',
  eventId: '',
  vmixHost: '127.0.0.1',
  vmixPort: 8088,
  pollSeconds: 1,
  /** vMix Data Source names for each Civics CSV filter */
  dataSources: {
    top25: { name: 'Civics Top 25', table: '' },
    top10: { name: 'Civics Top 10', table: '' },
    top5: { name: 'Civics Top 5', table: '' },
  },
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

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULTS, ...parsed };
    merged.apiBaseUrl = normalizeBaseUrl(merged.apiBaseUrl);
    merged.dataSources = {
      ...DEFAULTS.dataSources,
      ...(parsed.dataSources && typeof parsed.dataSources === 'object' ? parsed.dataSources : {}),
    };
    for (const key of ['top25', 'top10', 'top5']) {
      const ds = merged.dataSources[key] || {};
      merged.dataSources[key] = {
        name: String(ds.name || DEFAULTS.dataSources[key].name).trim(),
        table: String(ds.table || '').trim(),
      };
    }
    merged.pollSeconds = Math.max(0.5, Number(merged.pollSeconds) || 1);
    merged.vmixPort = Math.max(1, parseInt(String(merged.vmixPort), 10) || 8088);
    return merged;
  } catch {
    return { ...DEFAULTS, dataSources: { ...DEFAULTS.dataSources } };
  }
}

function saveConfig(cfg) {
  const next = { ...DEFAULTS, ...cfg };
  next.apiBaseUrl = normalizeBaseUrl(next.apiBaseUrl);
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf8');
  return loadConfig();
}

module.exports = { loadConfig, saveConfig, DEFAULTS, normalizeBaseUrl };
