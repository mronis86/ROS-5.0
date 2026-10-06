/**
 * Polls ROS Civics graphics selection and selects the matching Name row in vMix.
 * Independent of the everyday cue DataSource bridge.
 */

const vmix = require('./vmix-client');
const { normalizeBaseUrl } = require('./config-store');

function parseCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cells[idx] != null ? String(cells[idx]).trim() : '';
    });
    rows.push(obj);
  }
  return { headers, rows };
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function normalizeName(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

class BridgeController {
  constructor({ onStatus } = {}) {
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.config = null;
    this.timer = null;
    this.running = false;
    this.lastKey = '';
    this.lastError = '';
    this.lastOk = '';
    this.lastSelection = null;
  }

  emit(extra = {}) {
    this.onStatus({
      running: this.running,
      lastKey: this.lastKey,
      lastError: this.lastError,
      lastOk: this.lastOk,
      lastSelection: this.lastSelection,
      ...extra,
    });
  }

  setConfig(cfg) {
    this.config = cfg;
  }

  start(cfg) {
    this.stop();
    this.config = cfg;
    this.running = true;
    this.lastError = '';
    this.lastOk = 'Started — watching Civics selection';
    this.emit();
    const tick = () => {
      this.pollOnce().catch((err) => {
        this.lastError = err.message || String(err);
        this.emit();
      });
    };
    tick();
    const ms = Math.max(500, Math.round((Number(cfg.pollSeconds) || 1) * 1000));
    this.timer = setInterval(tick, ms);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.emit();
  }

  async pollOnce() {
    const cfg = this.config;
    if (!cfg?.eventId) throw new Error('Event ID is required');
    const base = normalizeBaseUrl(cfg.apiBaseUrl);
    const headers = { Accept: 'application/json' };
    const token = String(cfg.apiToken || '')
      .trim()
      .replace(/^Bearer\s+/i, '');
    if (token) headers.Authorization = `Bearer ${token}`;

    const selUrl = `${base}/api/civics-bee/selection?eventId=${encodeURIComponent(cfg.eventId)}`;
    const selRes = await fetch(selUrl, { headers });
    if (!selRes.ok) throw new Error(`Selection API HTTP ${selRes.status}`);
    const selJson = await selRes.json();
    const selection = selJson?.selection || null;
    this.lastSelection = selection;

    if (!selection || !selection.name || !selection.filter) {
      this.lastOk = 'No student selected in ROS';
      this.emit();
      return;
    }

    const key = `${selection.filter}|${selection.code}|${selection.name}|${selection.updatedAt || ''}`;
    if (key === this.lastKey) {
      this.emit();
      return;
    }

    const ds = cfg.dataSources?.[selection.filter];
    if (!ds?.name) throw new Error(`No Data Source configured for ${selection.filter}`);

    const csvUrl = `${base}/api/civics-bee.csv?eventId=${encodeURIComponent(cfg.eventId)}&filter=${encodeURIComponent(selection.filter)}`;
    const csvRes = await fetch(csvUrl, { headers: { Accept: 'text/csv' } });
    if (!csvRes.ok) throw new Error(`CSV HTTP ${csvRes.status}`);
    const csvText = await csvRes.text();
    const { rows } = parseCsv(csvText);
    const want = normalizeName(selection.name);
    let index = rows.findIndex((r) => normalizeName(r.name) === want);
    if (index < 0 && selection.state) {
      const wantState = normalizeName(selection.state);
      index = rows.findIndex(
        (r) => normalizeName(r.name) === want && normalizeName(r.state) === wantState
      );
    }
    if (index < 0) {
      throw new Error(`Name "${selection.name}" not found in ${selection.filter} CSV (${rows.length} rows)`);
    }

    const result = await vmix.selectRow(
      cfg.vmixHost,
      cfg.vmixPort,
      ds.name,
      ds.table || '',
      index
    );
    this.lastKey = key;
    this.lastError = '';
    this.lastOk = `Selected row ${index} · ${selection.name} → ${ds.name} (${result.value})`;
    this.emit();
  }
}

module.exports = { BridgeController, vmix, parseCsv };
