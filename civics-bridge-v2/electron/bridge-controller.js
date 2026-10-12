const { renderButtonPng, saveOneButtonPicture, setButtonPictureDir, ensureButtonPictureDir, buttonPictureDir, readButtonPicture } = require('./button-painter');
const { setButtonStyle } = require('./companion-client');
const { loadConfig, normalizeBaseUrl, stateLabelFor } = require('./config-store');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class BridgeController {
  constructor({ onStatus } = {}) {
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.running = false;
    this.timer = null;
    this.lastBuilt = '';
    this.lastOk = '';
    this.lastError = '';
    this.companionApi = null;
  }

  emit() {
    this.onStatus({
      running: this.running,
      lastOk: this.lastOk,
      lastError: this.lastError,
      pictureFolder: buttonPictureDir(),
      lastBuilt: this.lastBuilt,
    });
  }

  start(cfg) {
    this.stop();
    this.running = true;
    const wait = Math.max(1000, ((cfg || loadConfig()).pollSeconds || 2) * 1000);
    this.timer = setInterval(() => {
      this.pollOnce().catch((err) => {
        this.lastError = err.message || String(err);
        this.emit();
      });
    }, wait);
    this.pollOnce().catch((err) => {
      this.lastError = err.message || String(err);
      this.emit();
    });
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
    const url = `${base}/api/civics-bee/button-build?eventId=${encodeURIComponent(cfg.eventId)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Build feed HTTP ${res.status}`);
    const body = await res.json();
    const build = body?.build;
    const folder = ensureButtonPictureDir();
    if (!build?.requestedAt) {
      this.lastOk = `Waiting for a push from the Companion buttons tab. Pictures folder: ${folder}`;
      this.lastError = '';
      this.emit();
      return;
    }
    if (build.requestedAt === this.lastBuilt) {
      this.lastOk = `Buttons are current (${build.requestedAt}). Pictures folder: ${folder}`;
      this.lastError = '';
      this.emit();
      return;
    }
    if (build.action === 'clear') {
      await this.clearButtons(cfg, build);
      return;
    }
    await this.applyBuild(cfg, build);
  }

  async applyBuild(cfg, build) {
    const comp = cfg.companion;
    const count = comp.count;
    const slots = Array.isArray(build.slots) ? build.slots : [];
    const layout = build.pictureStyle || comp.pictureStyle || 'abbrev-name';
    const flagOutline = build.flagOutline === true || (build.flagOutline == null && comp.flagOutline === true);
    const folder = ensureButtonPictureDir();
    let apiMode = comp.apiVersion === 'v2' || comp.apiVersion === 'v3' ? comp.apiVersion : this.companionApi || 'auto';
    const failures = [];
    const sent = [];

    for (let i = 0; i < count; i += 1) {
      const slot = slots[i] || null;
      const useBank = comp.apiVersion === 'v2';
      const bank = (comp.firstBank || 1) + i;
      const row = useBank ? Math.floor((bank - 1) / 8) : comp.startRow + Math.floor(i / comp.columns);
      const column = useBank ? (bank - 1) % 8 : comp.startColumn + (i % comp.columns);
      const hasStudent = !!(slot && (slot.state || slot.name));
      const stateLabel = hasStudent ? stateLabelFor(slot.stateLabel || slot.state || '', comp) : '';
      let png = '';
      try {
        const eliminated = hasStudent && slot.eliminated === true;
        if (hasStudent && comp.buttonImages !== false) {
          png = await renderButtonPng({
            state: slot.state || '',
            stateLabel,
            name: slot.name || '',
            eliminated,
            flagOutline,
            layout,
            bgColor: '#808080',
          });
        }
        await saveOneButtonPicture(i, png, folder);
        const uploaded = png ? readButtonPicture(i, folder) || png : '';
        if (comp.enabled !== false && comp.buttonImages !== false) {
          const resultClear = await setButtonStyle(
            comp.host,
            comp.port,
            comp.page,
            row,
            column,
            { text: '', png64: '' },
            apiMode
          );
          if (apiMode === 'auto' && resultClear.api) {
            apiMode = resultClear.api;
            this.companionApi = resultClear.api;
          }
          await sleep(300);
          const fields = {
            text: '',
            size: '14',
            png64: uploaded,
            alignment: 'center:center',
            pngalignment: 'center:center',
          };
          if (eliminated) fields.bgcolor = '#808080';
          const result = await setButtonStyle(comp.host, comp.port, comp.page, row, column, fields, apiMode);
          if (apiMode === 'auto' && result.api) {
            apiMode = result.api;
            this.companionApi = result.api;
          }
          sent.push(
            `button ${i + 1}${hasStudent ? ' ' + (slot.state || '') : ' cleared'} ${eliminated ? 'grey' : 'transparent'}`
          );
        }
      } catch (err) {
        failures.push(`button ${i + 1}: ${err.message || err}`);
      }
    }

    this.lastBuilt = build.requestedAt;
    this.lastError = failures.join(' | ');
    const where = comp.apiVersion === 'v2' || this.companionApi === 'v2' ? 'Companion 2.4 page/bank' : 'Companion page';
    this.lastOk = [
      sent.length ? `${where}: ${sent.join(', ')}` : 'No Companion buttons were updated.',
      `Pictures folder: ${folder}`,
      `Page ${comp.page}. ${comp.apiVersion === 'v2' ? `2.4 banks ${comp.firstBank}-${comp.firstBank + count - 1}.` : `Start row ${comp.startRow}, start column ${comp.startColumn}.`}`,
    ].join(' · ');
    this.emit();
  }

  async clearButtons(cfg, build) {
    const comp = cfg.companion;
    const count = comp.count;
    const folder = ensureButtonPictureDir();
    let apiMode = comp.apiVersion === 'v2' || comp.apiVersion === 'v3' ? comp.apiVersion : this.companionApi || 'auto';
    const failures = [];
    const sent = [];
    for (let i = 0; i < count; i += 1) {
      const useBank = comp.apiVersion === 'v2';
      const bank = (comp.firstBank || 1) + i;
      const row = useBank ? Math.floor((bank - 1) / 8) : comp.startRow + Math.floor(i / comp.columns);
      const column = useBank ? (bank - 1) % 8 : comp.startColumn + (i % comp.columns);
      try {
        await saveOneButtonPicture(i, '', folder);
        if (comp.enabled !== false) {
          const result = await setButtonStyle(
            comp.host,
            comp.port,
            comp.page,
            row,
            column,
            { text: '', png64: '' },
            apiMode
          );
          if (apiMode === 'auto' && result.api) {
            apiMode = result.api;
            this.companionApi = result.api;
          }
          await sleep(150);
        }
        sent.push(`button ${i + 1} cleared`);
      } catch (err) {
        failures.push(`button ${i + 1}: ${err.message || err}`);
      }
    }
    this.lastBuilt = build.requestedAt;
    this.lastError = failures.join(' | ');
    this.lastOk = [
      sent.length ? `Cleared ${sent.length} Companion button picture${sent.length === 1 ? '' : 's'}.` : 'No Companion buttons were cleared.',
      `Pictures folder: ${folder}`,
    ].join(' ');
    this.emit();
  }
}

module.exports = { BridgeController };
