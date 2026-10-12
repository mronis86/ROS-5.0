const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const {
  renderButtonPng,
  saveOneButtonPicture,
  setButtonPictureDir,
  ensureButtonPictureDir,
  buttonPictureDir,
  readButtonPicture,
  pictureStats,
} = require('./button-painter');
const { setButtonStyle } = require('./companion-client');
const { loadConfig, normalizeBaseUrl, stateLabelFor } = require('./config-store');

const INSTANCE_ID = crypto.randomBytes(4).toString('hex');
const MANIFEST = 'generated-buttons.json';
const MAX_FILES = 32;
const RENDER_TRIES = 3;

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

function sha(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
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
        `Buttons per row is ${perRow} starting at bank ${start + 1}, which runs past the 8 buttons in a Companion 2.4 row. Set buttons per row to ${Math.max(1, 8 - (start % 8))} or less.`
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

function targetKey(comp) {
  return JSON.stringify([comp.host, comp.port, comp.page, apiModeOf(comp), layoutOf(comp).spots]);
}

function manifestPath(folder) {
  return path.join(folder, MANIFEST);
}

function readManifest(folder) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(folder), 'utf8'));
  } catch {
    return null;
  }
}

function removeOldPictures(folder) {
  for (let i = 0; i < MAX_FILES; i += 1) {
    for (const suffix of ['.png', '-large.png']) {
      const file = path.join(folder, `${String(i + 1).padStart(2, '0')}${suffix}`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
  if (fs.existsSync(manifestPath(folder))) fs.unlinkSync(manifestPath(folder));
}

function checkPicture(png, eliminated) {
  if (!png || !png.startsWith('data:image/png')) return 'The picture file is missing or not a PNG.';
  const stats = pictureStats(png);
  if (!stats) return '';
  if (stats.width !== 72 || stats.height !== 58) return `The picture is ${stats.width}x${stats.height}, not 72x58.`;
  if (!eliminated && stats.clearPct < 30) return `The still-in picture is only ${stats.clearPct}% transparent.`;
  if (eliminated && stats.clearPct > 5) return 'The eliminated picture is missing its grey background.';
  return '';
}

class BridgeController {
  constructor({ onStatus } = {}) {
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.running = false;
    this.timer = null;
    this.lastSeen = null;
    this.busy = false;
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
    void postLog(cfg || loadConfig(), `Bridge ${bridgeVersion()} started. It only acts on a new Generate, Import, or Clear from the website.`);
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
    const res = await fetch(
      `${base}/api/civics-bee/button-build?eventId=${encodeURIComponent(cfg.eventId)}&protocol=2`,
      { headers: { Accept: 'application/json' } }
    );
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

    const layout = layoutOf(comp);
    if (layout.error) {
      await this.report(cfg, build, [{ n: 0, where: '', state: 'failed', message: layout.error }], true);
      await postLog(cfg, `Refused ${build.action}. Nothing was sent to Companion. ${layout.error}`);
      this.lastError = `Refused: ${layout.error}`;
      this.emit();
      return;
    }

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

  finish(buttons, okText) {
    const failed = buttons.filter((b) => b.state === 'failed').length;
    this.lastOk = failed ? '' : okText;
    this.lastError = failed ? `${failed} button(s) failed. See the website for each one.` : '';
    this.emit();
  }

  async renderWithRetry(spec) {
    let lastErr = null;
    for (let attempt = 1; attempt <= RENDER_TRIES; attempt += 1) {
      try {
        const png = await renderButtonPng(spec);
        const problem = checkPicture(png, spec.eliminated);
        if (problem) throw new Error(problem);
        return png;
      } catch (err) {
        lastErr = err;
        await sleep(400);
      }
    }
    throw lastErr || new Error('The picture could not be drawn.');
  }

  /** Draws every picture into the folder. Companion is never touched here. */
  async generate(cfg, build) {
    const comp = cfg.companion;
    const slots = Array.isArray(build.slots) ? build.slots : [];
    const pictureStyle = build.pictureStyle || 'abbrev-name';
    const flagOutline = build.flagOutline === true;
    const folder = ensureButtonPictureDir();
    await postLog(
      cfg,
      `Generate: style ${pictureStyle}${flagOutline ? ' with flag outline' : ''}, ${comp.count} buttons, into ${folder}. Companion is not touched.`
    );
    removeOldPictures(folder);

    try {
      await renderButtonPng({ state: 'CA', stateLabel: 'California', name: 'Warm up', layout: 'abbrev-name' });
    } catch {
      /* the first real picture reports its own error */
    }

    const buttons = [];
    const manifestButtons = [];
    for (let i = 0; i < comp.count; i += 1) {
      const slot = slots[i] || null;
      const hasStudent = !!(slot && (slot.state || slot.name));
      const eliminated = hasStudent && slot.eliminated === true;
      const pos = buttonPosition(comp, i);
      const entry = { n: i + 1, where: pos.where, state: 'created', message: '', png: '' };
      try {
        if (hasStudent) {
          const png = await this.renderWithRetry({
            state: slot.state || '',
            stateLabel: stateLabelFor(slot.stateLabel || slot.state || '', comp),
            name: slot.name || '',
            eliminated,
            flagOutline,
            layout: pictureStyle,
            bgColor: '#808080',
          });
          await saveOneButtonPicture(i, png, folder);
          const saved = readButtonPicture(i, folder);
          if (saved !== png) throw new Error('The saved picture file does not match what was drawn.');
          entry.png = png;
          entry.message = `${slot.state || slot.name}${eliminated ? ', grey eliminated' : ', transparent'}`;
          manifestButtons.push({ n: i + 1, where: pos.where, hasStudent: true, eliminated, sha: sha(png) });
        } else {
          entry.state = 'empty';
          entry.message = 'No student. This button will be left blank.';
          manifestButtons.push({ n: i + 1, where: pos.where, hasStudent: false, eliminated: false, sha: '' });
        }
      } catch (err) {
        entry.state = 'failed';
        entry.message = err.message || String(err);
      }
      buttons.push(entry);
      await this.report(cfg, build, buttons, false);
    }

    const failed = buttons.filter((b) => b.state === 'failed').length;
    if (!failed) {
      fs.writeFileSync(
        manifestPath(folder),
        JSON.stringify(
          {
            generateId: build.requestedAt,
            pictureStyle,
            flagOutline,
            target: targetKey(comp),
            buttons: manifestButtons,
          },
          null,
          2
        )
      );
    }
    await this.report(cfg, build, buttons, true);
    await postLog(
      cfg,
      failed
        ? `Generate finished with ${failed} failed picture(s). Import is blocked until Generate succeeds.`
        : `Generate finished. ${manifestButtons.filter((b) => b.hasStudent).length} pictures are ready. Waiting for Import.`
    );
    this.finish(buttons, `Generated ${buttons.length} pictures. Waiting for Import from the website.`);
  }

  /**
   * Checks every picture first. Only when all of them pass does it delete every target button,
   * and only after all deletes succeed does it load the new pictures.
   */
  async importToCompanion(cfg, build) {
    const comp = cfg.companion;
    const folder = ensureButtonPictureDir();
    const mode = apiModeOf(comp);
    const refuse = async (message) => {
      await this.report(cfg, build, [{ n: 0, where: '', state: 'failed', message }], true);
      await postLog(cfg, `Import refused. Nothing was sent to Companion. ${message}`);
      this.lastError = `Import refused: ${message}`;
      this.emit();
    };

    const manifest = readManifest(folder);
    if (!manifest || manifest.generateId !== build.generateId) {
      return refuse('These pictures are not the ones from your last Generate. Click Preview and Generate again.');
    }
    if (manifest.target !== targetKey(comp)) {
      return refuse('The bridge Companion settings changed after Generate. Generate again.');
    }
    if (!Array.isArray(manifest.buttons) || manifest.buttons.length !== comp.count) {
      return refuse('The number of buttons changed after Generate. Generate again.');
    }

    const plan = [];
    for (let i = 0; i < comp.count; i += 1) {
      const item = manifest.buttons[i];
      const pos = buttonPosition(comp, i);
      let png = '';
      if (item.hasStudent) {
        png = readButtonPicture(i, folder);
        const problem = checkPicture(png, item.eliminated) || (sha(png) !== item.sha ? 'The picture file changed after Generate.' : '');
        if (problem) return refuse(`Button ${i + 1}: ${problem}`);
      }
      plan.push({ i, pos, item, png });
    }
    await postLog(
      cfg,
      `Import: all ${plan.length} pictures checked. Removing ${plan.map((p) => p.pos.where).join(', ')} on page ${comp.page}, then loading.`
    );

    const buttons = plan.map((p) => ({ n: p.i + 1, where: p.pos.where, state: 'checked', message: 'Picture checked' }));
    await this.report(cfg, build, buttons, false);

    for (const p of plan) {
      const entry = buttons[p.i];
      try {
        await setButtonStyle(
          comp.host,
          comp.port,
          comp.page,
          p.pos.row,
          p.pos.column,
          { text: '', png64: '', bgcolor: '#000000' },
          mode
        );
        entry.state = 'removed';
        entry.message = 'Old button removed';
      } catch (err) {
        entry.state = 'failed';
        entry.message = `Could not remove the old button: ${err.message || err}`;
      }
      await this.report(cfg, build, buttons, false);
      await sleep(100);
    }
    if (buttons.some((b) => b.state === 'failed')) {
      await this.report(cfg, build, buttons, true);
      await postLog(cfg, 'Import stopped. Some old buttons could not be removed, so no new pictures were loaded.');
      this.finish(buttons, '');
      return;
    }

    await sleep(500);

    for (const p of plan) {
      const entry = buttons[p.i];
      try {
        if (p.item.hasStudent) {
          const fields = { text: '', png64: p.png, pngalignment: 'center:center' };
          if (p.item.eliminated) fields.bgcolor = '#808080';
          await setButtonStyle(comp.host, comp.port, comp.page, p.pos.row, p.pos.column, fields, mode);
          entry.state = 'imported';
          entry.message = p.item.eliminated ? 'Grey eliminated picture loaded' : 'Transparent picture loaded';
        } else {
          entry.state = 'cleared';
          entry.message = 'No student. Left blank.';
        }
      } catch (err) {
        entry.state = 'failed';
        entry.message = err.message || String(err);
      }
      await this.report(cfg, build, buttons, false);
      await sleep(150);
    }
    await this.report(cfg, build, buttons, true);
    await postLog(cfg, `Import finished on page ${comp.page}.`);
    this.finish(buttons, `Imported ${buttons.length} buttons to Companion page ${comp.page}.`);
  }

  async clear(cfg, build) {
    const comp = cfg.companion;
    const folder = ensureButtonPictureDir();
    const mode = apiModeOf(comp);
    const spots = layoutOf(comp).spots;
    await postLog(cfg, `Clear: Companion ${comp.host}:${comp.port} page ${comp.page}, ${spots.join(', ')}.`);
    removeOldPictures(folder);
    const buttons = [];
    for (let i = 0; i < comp.count; i += 1) {
      const pos = buttonPosition(comp, i);
      const entry = { n: i + 1, where: pos.where, state: 'cleared', message: '' };
      try {
        await setButtonStyle(
          comp.host,
          comp.port,
          comp.page,
          pos.row,
          pos.column,
          { text: '', png64: '', bgcolor: '#000000' },
          mode
        );
        entry.message = 'Picture removed, background black';
      } catch (err) {
        entry.state = 'failed';
        entry.message = err.message || String(err);
      }
      buttons.push(entry);
      await this.report(cfg, build, buttons, false);
      await sleep(100);
    }
    await this.report(cfg, build, buttons, true);
    await postLog(cfg, `Clear finished on page ${comp.page}.`);
    this.finish(buttons, `Cleared ${buttons.length} buttons on Companion page ${comp.page}.`);
  }
}

module.exports = { BridgeController, buttonPosition };
