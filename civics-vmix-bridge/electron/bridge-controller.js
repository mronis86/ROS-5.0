/**
 * Polls ROS Civics graphics selection → match row in the same Feed URL as vMix → DataSourceSelectRow.
 * Config shape mirrors the everyday ROS vMix DataSource Bridge (name / sheet / feed URL).
 *
 * Token: NOT required. /api/civics-bee/selection and /api/civics-bee.csv are public graphics feeds.
 */

const http = require('http');
const vmix = require('./vmix-client');
const { setButtonStyle } = require('./companion-client');
const { normalizeBaseUrl, loadConfig } = require('./config-store');

const STILL_IN_BG = '#1e3a5f';
const STILL_IN_FG = '#ffffff';
const LIVE_BG = '#16a34a';
const LIVE_FG = '#052e16';
const ELIMINATED_BG = '#3f3f46';
const ELIMINATED_FG = '#d4d4d8';
const EMPTY_BG = '#0f172a';
const EMPTY_FG = '#64748b';

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
    // physicalIndex = line number in file (header=0, first data=1)
    // dataIndex = 0-based among data rows only
    obj.__dataIndex = rows.length;
    obj.__physicalIndex = i;
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

function normalizeKey(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function findRow(rows, selection, matchColumn) {
  const wantName = normalizeKey(selection.name);
  const wantState = normalizeKey(selection.state);
  const preferState = matchColumn !== 'name';

  if (preferState && wantState) {
    const hit = rows.find((r) => normalizeKey(r.state) === wantState);
    if (hit) return { row: hit, how: 'state' };
  }
  if (wantName) {
    const hit = rows.find((r) => normalizeKey(r.name) === wantName);
    if (hit) return { row: hit, how: 'name' };
  }
  if (wantName && wantState) {
    const hit = rows.find(
      (r) => normalizeKey(r.name) === wantName && normalizeKey(r.state) === wantState
    );
    if (hit) return { row: hit, how: 'name+state' };
  }
  if (!preferState && wantState) {
    const hit = rows.find((r) => normalizeKey(r.state) === wantState);
    if (hit) return { row: hit, how: 'state' };
  }
  return { row: null, how: 'none' };
}

function vmixIndexForRow(row, csvHeaderIsDataRow) {
  if (!row) return -1;
  // Same as everyday bridge: header-as-columns → dataIndex; header-is-data → physicalIndex
  return csvHeaderIsDataRow === true ? row.__physicalIndex : row.__dataIndex;
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
    this.lastVmixUrl = '';
    this.lastCompanionOk = '';
    this.lastCompanionError = '';
    this.lastCompanionKey = '';
    this.navServer = null;
    this.navPort = 0;
  }

  emit(extra = {}) {
    this.onStatus({
      running: this.running,
      lastKey: this.lastKey,
      lastError: this.lastError,
      lastOk: this.lastOk,
      lastSelection: this.lastSelection,
      lastVmixUrl: this.lastVmixUrl,
      lastCompanionOk: this.lastCompanionOk,
      lastCompanionError: this.lastCompanionError,
      ...extra,
    });
  }

  start(cfg) {
    this.stop();
    this.config = cfg;
    this.running = true;
    this.lastError = '';
    this.lastKey = '';
    this.lastOk = 'Started — watching Civics selection (token not required)';
    this.ensureNavigateServer(cfg);
    this.emit();
    const tick = () => {
      this.pollOnce().catch((err) => {
        this.lastError = err.message || String(err);
        if (err.url) this.lastVmixUrl = err.url;
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
    this.stopNavigateServer();
    this.emit();
  }

  stopNavigateServer() {
    if (this.navServer) {
      this.navServer.close();
      this.navServer = null;
      this.navPort = 0;
    }
  }

  /** Companion button press → select that Top 10 student's row in vMix. */
  ensureNavigateServer(cfg) {
    const comp = cfg?.companion;
    if (!comp?.enabled) {
      this.stopNavigateServer();
      return;
    }
    const port = Math.max(1, parseInt(String(comp.listenPort), 10) || 3921);
    if (this.navServer && this.navPort === port) return;
    this.stopNavigateServer();
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      const match = String(req.url || '').match(/^\/top10\/(\d+)/);
      if (!match || req.method === 'OPTIONS') {
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Use /top10/0 for the first Top 10 button');
        return;
      }
      this.selectTop10Slot(Number(match[1]))
        .then((message) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(message);
        })
        .catch((err) => {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(err.message || String(err));
        });
    });
    server.on('error', (err) => {
      this.lastCompanionError = `Button listener: ${err.message || err}`;
      this.navServer = null;
      this.navPort = 0;
      this.emit();
    });
    server.listen(port, '127.0.0.1', () => {
      this.navPort = port;
    });
    this.navServer = server;
  }

  async selectTop10Slot(slotIndex) {
    const cfg = this.refreshConfig();
    const binding = (cfg.bindings || []).find((b) => b.filter === 'top10' && b.enabled !== false);
    if (!binding?.dataSourceName) {
      throw new Error('Top 10 Data Source name is required');
    }
    const csvText = await this.fetchCsv(this.feedUrlFor(cfg, 'top10'));
    const rows = parseCsv(csvText).rows.filter((r) => r.name || r.state);
    const sorted = rows
      .slice()
      .sort((a, b) => String(a.state || '').localeCompare(String(b.state || '')));
    const student = sorted[slotIndex];
    if (!student) throw new Error(`No Top 10 student on button ${slotIndex + 1}`);
    const index = vmixIndexForRow(student, binding.csvHeaderIsDataRow === true);
    const result = await vmix.selectRow(
      cfg.vmixHost,
      cfg.vmixPort,
      binding.dataSourceName,
      binding.tableName,
      index
    );
    this.lastVmixUrl = result.url;
    this.lastCompanionKey = '';
    this.lastOk = `Button ${slotIndex + 1} → ${student.name} (${student.state}) row ${index}`;
    this.lastError = '';
    this.emit();
    return this.lastOk;
  }

  /** Always re-read saved config so Save while running takes effect. */
  refreshConfig() {
    this.config = loadConfig();
    return this.config;
  }

  bindingsForFilter(cfg, filter) {
    return (cfg.bindings || []).filter((b) => b.enabled !== false && b.filter === filter);
  }

  async fetchCsv(feedUrl) {
    const res = await fetch(feedUrl, { headers: { Accept: 'text/csv,*/*' } });
    if (!res.ok) throw new Error(`Feed HTTP ${res.status}: ${feedUrl}`);
    return res.text();
  }

  feedUrlFor(cfg, filter) {
    const binding = (cfg.bindings || []).find((b) => b.filter === filter);
    if (binding?.feedUrl) return binding.feedUrl;
    const base = normalizeBaseUrl(cfg.apiBaseUrl);
    return `${base}/api/civics-bee.csv?eventId=${encodeURIComponent(cfg.eventId)}&filter=${encodeURIComponent(filter)}`;
  }

  /**
   * Top 10 names onto Companion buttons. Grey background once a Top 5 exists
   * and this student is not in it.
   */
  async syncCompanion(cfg) {
    const comp = cfg.companion;
    if (!comp?.enabled) {
      this.lastCompanionOk = '';
      this.lastCompanionError = '';
      this.lastCompanionKey = '';
      return;
    }

    const [top10Text, top5Text] = await Promise.all([
      this.fetchCsv(this.feedUrlFor(cfg, 'top10')),
      this.fetchCsv(this.feedUrlFor(cfg, 'top5')),
    ]);
    const top10Rows = parseCsv(top10Text).rows.filter((r) => r.name || r.state);
    const top10 = top10Rows
      .slice()
      .sort((a, b) => String(a.state || '').localeCompare(String(b.state || '')));
    const top10Binding = (cfg.bindings || []).find((b) => b.filter === 'top10' && b.enabled !== false);
    let live = null;
    let liveNote = '';
    if (top10Binding?.dataSourceName) {
      try {
        const xml = await vmix.fetchApiXml(cfg.vmixHost, cfg.vmixPort);
        const selectedIndex = vmix.parseDataSourceSelectedRow(xml, top10Binding.dataSourceName);
        if (selectedIndex == null) {
          liveNote = 'vMix did not report the current row';
        } else {
          const headerIsData = top10Binding.csvHeaderIsDataRow === true;
          const hit = top10Rows.find((r) => vmixIndexForRow(r, headerIsData) === selectedIndex);
          if (hit) {
            live = { name: normalizeKey(hit.name), state: normalizeKey(hit.state) };
            liveNote = `vMix row ${selectedIndex}: ${hit.state} / ${hit.name}`;
          } else {
            liveNote = `vMix row ${selectedIndex} is not in the Top 10 list`;
          }
        }
      } catch (err) {
        liveNote = err.message || String(err);
      }
    }
    const top5States = new Set(
      parseCsv(top5Text).rows.map((r) => normalizeKey(r.state)).filter(Boolean)
    );
    const anyAdvanced = top5States.size > 0;
    const count = comp.count;

    const slots = [];
    for (let i = 0; i < count; i += 1) {
      const student = top10[i] || null;
      const eliminated =
        !!student && anyAdvanced && !top5States.has(normalizeKey(student.state));
      const colSpan = comp.columns;
      const row = comp.startRow + Math.floor(i / colSpan);
      const column = comp.startColumn + (i % colSpan);
      let text = '';
      let bgcolor = EMPTY_BG;
      let color = EMPTY_FG;
      const isLive =
        !!student &&
        !!live &&
        ((live.state && normalizeKey(student.state) === live.state) ||
          (live.name && normalizeKey(student.name) === live.name));
      if (student) {
        const state = student.state || '';
        const name = student.name || '';
        text = `${state}\n${name}`;
        if (isLive) {
          bgcolor = LIVE_BG;
          color = LIVE_FG;
        } else if (eliminated) {
          bgcolor = ELIMINATED_BG;
          color = ELIMINATED_FG;
        } else {
          bgcolor = STILL_IN_BG;
          color = STILL_IN_FG;
        }
      }
      slots.push({ page: comp.page, row, column, text, bgcolor, color, eliminated });
    }

    const key = JSON.stringify(slots);
    if (key === this.lastCompanionKey) {
      return;
    }

    for (const slot of slots) {
      await setButtonStyle(comp.host, comp.port, slot.page, slot.row, slot.column, {
        text: slot.text,
        bgcolor: slot.bgcolor,
        color: slot.color,
      });
    }

    this.lastCompanionKey = key;
    const eliminatedCount = slots.filter((s) => s.eliminated).length;
    const filled = Math.min(top10.length, count);
    const listen = comp.listenPort || 3921;
    this.lastCompanionOk = [
      anyAdvanced
        ? `Companion: ${filled} Top 10 buttons, ${eliminatedCount} grey (not in Top 5)`
        : `Companion: ${filled} Top 10 buttons (no one marked Top 5 yet)`,
      liveNote,
      `Press URL http://127.0.0.1:${listen}/top10/0 … /${Math.max(0, count - 1)}`,
    ]
      .filter(Boolean)
      .join(' · ');
    this.lastCompanionError = '';
  }

  async pollOnce() {
    const cfg = this.refreshConfig();
    if (!cfg?.eventId) {
      throw new Error('Event ID is required — paste the UUID from the Civics page URL (?eventId=…)');
    }

    this.ensureNavigateServer(cfg);
    if (cfg.companion?.enabled) {
      try {
        await this.syncCompanion(cfg);
      } catch (err) {
        this.lastCompanionError = err.message || String(err);
        this.lastCompanionKey = '';
      }
    } else {
      this.lastCompanionOk = '';
      this.lastCompanionError = '';
    }

    const base = normalizeBaseUrl(cfg.apiBaseUrl);
    const selUrl = `${base}/api/civics-bee/selection?eventId=${encodeURIComponent(cfg.eventId)}`;
    const selRes = await fetch(selUrl, { headers: { Accept: 'application/json' } });
    if (!selRes.ok) {
      throw new Error(`Selection API HTTP ${selRes.status} at ${selUrl}`);
    }
    const selJson = await selRes.json();
    const selection = selJson?.selection || null;
    this.lastSelection = selection;

    if (!selection || !selection.filter) {
      this.lastOk = 'Listening… no student selected in ROS yet';
      this.emit();
      return;
    }

    const key = `${selection.filter}|${selection.code}|${selection.name}|${selection.updatedAt || ''}`;
    if (key === this.lastKey) {
      this.emit();
      return;
    }

    const bindings = this.bindingsForFilter(cfg, selection.filter);
    if (!bindings.length) {
      throw new Error(`No enabled binding for filter "${selection.filter}". Fill Data Source + Feed URL for that tier.`);
    }

    const results = [];
    for (const binding of bindings) {
      if (!binding.dataSourceName) {
        throw new Error(`${binding.label || binding.filter}: Data Source Name is required (exact vMix name)`);
      }
      if (!binding.feedUrl) {
        throw new Error(
          `${binding.label || binding.filter}: Feed URL is required — paste the SAME live CSV URL used in vMix Data Sources`
        );
      }

      const csvText = await this.fetchCsv(binding.feedUrl);
      const { rows } = parseCsv(csvText);
      if (!rows.length) {
        throw new Error(`${binding.label}: feed parsed 0 rows — ${binding.feedUrl}`);
      }

      const found = findRow(rows, selection, binding.matchColumn);
      if (!found.row) {
        const sample = rows
          .slice(0, 3)
          .map((r) => `${r.name} / ${r.state}`)
          .join(' · ');
        throw new Error(
          `${binding.label}: no row for "${selection.name}" / ${selection.state} in feed (${rows.length} rows). Sample: ${sample}`
        );
      }

      const index = vmixIndexForRow(found.row, binding.csvHeaderIsDataRow === true);
      const result = await vmix.selectRow(
        cfg.vmixHost,
        cfg.vmixPort,
        binding.dataSourceName,
        binding.tableName,
        index
      );
      this.lastVmixUrl = result.url;
      results.push(
        `${binding.dataSourceName}${binding.tableName ? '/' + binding.tableName : ''} idx ${index} via ${found.how} → ${result.value}`
      );
    }

    this.lastKey = key;
    this.lastError = '';
    this.lastOk = `SELECTED: ${selection.name} (${selection.state}) · ${results.join(' | ')}`;
    this.emit();
  }

  /** Fire DataSourceSelectRow index 0 on a binding — proves vMix name/sheet wiring. */
  async testSelectBinding(bindingId) {
    const cfg = this.refreshConfig();
    const binding = (cfg.bindings || []).find((b) => b.id === bindingId || b.filter === bindingId);
    if (!binding) throw new Error('Binding not found');
    if (!binding.dataSourceName) throw new Error('Data Source Name required');
    const result = await vmix.selectRow(
      cfg.vmixHost,
      cfg.vmixPort,
      binding.dataSourceName,
      binding.tableName,
      0
    );
    this.lastVmixUrl = result.url;
    this.lastOk = `Test select row 0 on "${binding.dataSourceName}" OK → ${result.value}`;
    this.lastError = '';
    this.emit();
    return result;
  }
}

module.exports = { BridgeController, vmix, parseCsv, findRow, vmixIndexForRow };
