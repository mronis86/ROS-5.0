const crypto = require('crypto');
const { app } = require('electron');
const { renderButtonPng, saveOneButtonPicture, setButtonPictureDir, ensureButtonPictureDir, buttonPictureDir, readButtonPicture } = require('./button-painter');
const { setButtonStyle } = require('./companion-client');
const { loadConfig, normalizeBaseUrl, stateLabelFor } = require('./config-store');

const INSTANCE_ID = crypto.randomBytes(4).toString('hex');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bridgeVersion() {
  try {
    return app.getVersion();
  } catch {
    return '';
  }
}

async function postReport(cfg, payload) {
  try {
    const base = normalizeBaseUrl(cfg && cfg.apiBaseUrl);
    const eventId = String((cfg && cfg.eventId) || '').trim();
    if (!base || !eventId) return;
    await fetch(`${base}/api/civics-bee/bridge-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ eventId, instanceId: INSTANCE_ID, ...payload }),
    });
  } catch {
    /* the button job still finishes if the log page is unreachable */
  }
}

function postLog(cfg, message) {
  return postReport(cfg, { message: String(message || '').slice(0, 500) });
}

/**
 * Companion 2.4 pages are 8 banks wide. First bank is the top-left button of the block and
 * buttons per row wraps it, so 10 buttons at 5 per row from bank 1 use banks 1-5 and 9-13.
 * Companion 3 and 5 use start row and start column instead of first bank.
 */
function buttonPosition(comp, i) {
  const perRow = Math.max(1, comp.columns || 1);
  if (comp.apiVersion !== 'v3') {
    const start = Math.max(1, comp.firstBank || 1) - 1;
    const row = Math.floor(start / 8) + Math.floor(i / perRow);
    const column = (start % 8) + (i % perRow);
    if (column > 7) {
      throw new Error(
        `Button ${i + 1} would be past the 8th column. First bank column plus buttons per row must fit in 8.`
      );
    }
    const bank = row * 8 + column + 1;
    return { row, column, bank, where: `bank ${bank}` };
  }
  const row = comp.startRow + Math.floor(i / perRow);
  const column = comp.startColumn + (i % perRow);
  return { row, column, bank: 0, where: `row ${row} column ${column}` };
}

function layoutOf(comp) {
  const spots = [];
  let error = '';
  for (let i = 0; i < comp.count; i += 1) {
    try {
      spots.push(buttonPosition(comp, i).where);
    } catch (err) {
      error = err.message || String(err);
      break;
    }
  }
  return { spots, error };
}

function bridgeStatus(cfg) {
  const comp = cfg.companion;
  const layout = layoutOf(comp);
  return {
    host: comp.host,
    port: comp.port,
    page: comp.page,
    version: comp.apiVersion === 'v3' ? '3 or 5' : '2.4',
    perRow: comp.columns,
    count: comp.count,
    spots: layout.spots,
    layoutError: layout.error,
    bridgeVersion: bridgeVersion(),
  };
}

function apiModeOf(comp) {
  return comp.apiVersion === 'v3' ? 'v3' : 'v2';
}

class BridgeController {
  constructor({ onStatus } = {}) {
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.running = false;
    this.timer = null;
    this.lastSeen = null;
    this.busy = false;
    this.generated = null;
    this.lastOk = '';
    this.lastError = '';
  }

  emit() {
    this.onStatus({
      running: this.running,
      lastOk: this.lastOk,
      lastError: this.lastError,
      pictureFolder: buttonPictureDir(),
    });
  }

  start(cfg) {
    this.stop();
    this.running = true;
    this.lastSeen = null;
    const wait = Math.max(1000, ((cfg || loadConfig()).pollSeconds || 2) * 1000);
    const tick = () => {
      if (this.busy) return;
      this.busy = true;
      this.pollOnce()
        .catch((err) => {
          this.lastError = err.message || String(err);
          this.emit();
          void postLog(loadConfig(), `Bridge error: ${this.lastError}`);
        })
        .finally(() => {
          this.busy = false;
        });
    };
    this.timer = setInterval(tick, wait);
    tick();
    void postLog(cfg || loadConfig(), 'Bridge started. It only acts on a new Generate, Import, or Clear from the website.');
    this.emit();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.emit();
  }

  async pollOnce() {
    const cfg = loadConfig();
    if (!cfg.eventId) throw new Error('Event ID is required.');
    const comp = cfg.companion;
    setButtonPictureDir(comp.pictureFolder || '');
    const base = normalizeBaseUrl(cfg.apiBaseUrl);
    const res = await fetch(`${base}/api/civics-bee/button-build?eventId=${encodeURIComponent(cfg.eventId)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Build feed HTTP ${res.status}`);
    const body = await res.json();
    const build = body && body.build;
    await postReport(cfg, { status: bridgeStatus(cfg) });
    const requestedAt = (build && build.requestedAt) || '';

    if (this.lastSeen === null) {
      this.lastSeen = requestedAt;
      this.lastOk = 'Waiting for a new request from the website.';
      this.lastError = '';
      this.emit();
      return;
    }
    if (!requestedAt || requestedAt === this.lastSeen) return;
    this.lastSeen = requestedAt;

    if (build.action === 'generate') return this.generate(cfg, build);
    if (build.action === 'import') return this.importToCompanion(cfg, build);
    if (build.action === 'clear') return this.clear(cfg, build);
    await postLog(cfg, `Ignored a request the bridge does not know (${build.action || 'none'}). Nothing was changed.`);
  }

  async report(cfg, build, buttons, done) {
    await postReport(cfg, {
      result: { requestedAt: build.requestedAt, action: build.action, done, buttons },
    });
  }

  async generate(cfg, build) {
    const comp = cfg.companion;
    const slots = Array.isArray(build.slots) ? build.slots : [];
    const layout = build.pictureStyle || 'abbrev-name';
    const flagOutline = build.flagOutline === true;
    const folder = ensureButtonPictureDir();
    const buttons = [];
    await postLog(cfg, `Generate ${build.requestedAt}: drawing ${comp.count} pictures into ${folder}. Companion is not touched.`);
    const made = [];
    for (let i = 0; i < comp.count; i += 1) {
      const slot = slots[i] || null;
      const hasStudent = !!(slot && (slot.state || slot.name));
      const entry = { n: i + 1, where: '', state: 'created', message: '' };
      try {
        entry.where = buttonPosition(comp, i).where;
        let png = '';
        if (hasStudent) {
          png = await renderButtonPng({
            state: slot.state || '',
            stateLabel: stateLabelFor(slot.stateLabel || slot.state || '', comp),
            name: slot.name || '',
            eliminated: slot.eliminated === true,
            flagOutline,
            layout,
            bgColor: '#808080',
          });
        }
        await saveOneButtonPicture(i, png, folder);
        made.push({ hasStudent, eliminated: hasStudent && slot.eliminated === true });
        entry.message = hasStudent
          ? `${slot.state || slot.name}${slot.eliminated ? ' (grey, eliminated)' : ' (transparent)'}`
          : 'no student, stays empty';
      } catch (err) {
        made.push(null);
        entry.state = 'failed';
        entry.message = err.message || String(err);
      }
      buttons.push(entry);
      await this.report(cfg, build, buttons, false);
    }
    this.generated = { requestedAt: build.requestedAt, made };
    await this.report(cfg, build, buttons, true);
    const failed = buttons.filter((b) => b.state === 'failed').length;
    this.lastOk = `Generated ${buttons.length - failed} of ${buttons.length} pictures. Waiting for Import from the website.`;
    this.lastError = failed ? `${failed} picture(s) failed.` : '';
    this.emit();
  }

  async importToCompanion(cfg, build) {
    const comp = cfg.companion;
    const folder = ensureButtonPictureDir();
    const buttons = [];
    if (!this.generated || this.generated.requestedAt !== build.generateId) {
      buttons.push({
        n: 0,
        where: '',
        state: 'failed',
        message: 'These pictures were not generated by this bridge. Click Generate first.',
      });
      await this.report(cfg, build, buttons, true);
      await postLog(cfg, 'Import refused. Generate has to run on this bridge first.');
      return;
    }
    await postLog(cfg, `Import ${build.requestedAt}: sending to Companion ${comp.host}:${comp.port} page ${comp.page}.`);
    const mode = apiModeOf(comp);
    for (let i = 0; i < comp.count; i += 1) {
      const entry = { n: i + 1, where: '', state: 'imported', message: '' };
      try {
        const pos = buttonPosition(comp, i);
        entry.where = pos.where;
        const made = this.generated.made[i];
        if (made === null) throw new Error('This picture failed during Generate.');
        await setButtonStyle(comp.host, comp.port, comp.page, pos.row, pos.column, { text: '', png64: '' }, mode);
        await sleep(150);
        if (made && made.hasStudent) {
          const png = readButtonPicture(i, folder);
          if (!png) throw new Error(`Picture file ${String(i + 1).padStart(2, '0')}.png is missing.`);
          const fields = { text: '', png64: png, pngalignment: 'center:center' };
          if (made.eliminated) fields.bgcolor = '#808080';
          await setButtonStyle(comp.host, comp.port, comp.page, pos.row, pos.column, fields, mode);
          entry.message = made.eliminated ? 'grey eliminated picture' : 'transparent picture';
        } else {
          entry.state = 'cleared';
          entry.message = 'no student, picture removed';
        }
      } catch (err) {
        entry.state = 'failed';
        entry.message = err.message || String(err);
      }
      buttons.push(entry);
      await this.report(cfg, build, buttons, false);
      await sleep(100);
    }
    await this.report(cfg, build, buttons, true);
    const failed = buttons.filter((b) => b.state === 'failed').length;
    this.lastOk = `Imported ${buttons.length - failed} of ${buttons.length} buttons to Companion page ${comp.page}.`;
    this.lastError = failed ? `${failed} button(s) failed.` : '';
    this.emit();
  }

  async clear(cfg, build) {
    const comp = cfg.companion;
    const folder = ensureButtonPictureDir();
    const buttons = [];
    const mode = apiModeOf(comp);
    await postLog(cfg, `Clear ${build.requestedAt}: Companion ${comp.host}:${comp.port} page ${comp.page}.`);
    for (let i = 0; i < comp.count; i += 1) {
      const entry = { n: i + 1, where: '', state: 'cleared', message: '' };
      try {
        const pos = buttonPosition(comp, i);
        entry.where = pos.where;
        await saveOneButtonPicture(i, '', folder);
        await setButtonStyle(
          comp.host,
          comp.port,
          comp.page,
          pos.row,
          pos.column,
          { text: '', png64: '', bgcolor: '#000000' },
          mode
        );
        entry.message = 'picture removed, background black';
      } catch (err) {
        entry.state = 'failed';
        entry.message = err.message || String(err);
      }
      buttons.push(entry);
      await this.report(cfg, build, buttons, false);
      await sleep(100);
    }
    this.generated = null;
    await this.report(cfg, build, buttons, true);
    const failed = buttons.filter((b) => b.state === 'failed').length;
    this.lastOk = `Cleared ${buttons.length - failed} of ${buttons.length} buttons on Companion page ${comp.page}.`;
    this.lastError = failed ? `${failed} button(s) failed.` : '';
    this.emit();
  }
}

module.exports = { BridgeController, buttonPosition };
