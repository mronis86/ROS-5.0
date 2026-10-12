const { renderButtonPng, saveOneButtonPicture, setButtonPictureDir, ensureButtonPictureDir, buttonPictureDir } = require('./button-painter');
const { loadConfig, normalizeBaseUrl } = require('./config-store');

class BridgeController {
  constructor({ onStatus } = {}) {
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.running = false;
    this.timer = null;
    this.lastBuilt = '';
    this.lastOk = '';
    this.lastError = '';
    this.config = null;
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
    this.config = cfg || loadConfig();
    this.running = true;
    const wait = Math.max(1000, (this.config.pollSeconds || 2) * 1000);
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
    this.config = cfg;
    if (!cfg.eventId) throw new Error('Event ID is required.');
    if (!cfg.pictureFolder) throw new Error('Choose the folder Companion imports from.');
    setButtonPictureDir(cfg.pictureFolder);
    const base = normalizeBaseUrl(cfg.apiBaseUrl);
    const url = `${base}/api/civics-bee/button-build?eventId=${encodeURIComponent(cfg.eventId)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Build feed HTTP ${res.status}`);
    const body = await res.json();
    const build = body?.build;
    if (!build?.requestedAt) {
      this.lastOk = `Waiting for a push from the Civics Companion buttons tab. Folder: ${ensureButtonPictureDir()}`;
      this.lastError = '';
      this.emit();
      return;
    }
    if (build.requestedAt === this.lastBuilt) {
      this.lastOk = `Pictures are current (${build.requestedAt}). Folder: ${buttonPictureDir()}`;
      this.lastError = '';
      this.emit();
      return;
    }
    const slots = Array.isArray(build.slots) ? build.slots.slice(0, 10) : [];
    const folder = ensureButtonPictureDir();
    const files = [];
    for (let i = 0; i < 10; i += 1) {
      const slot = slots[i];
      let png = '';
      if (slot && (slot.state || slot.name)) {
        png = await renderButtonPng({
          state: slot.state || '',
          stateLabel: slot.stateLabel || slot.state || '',
          name: slot.name || '',
          eliminated: slot.eliminated === true,
          flagOutline: build.flagOutline === true,
          layout: build.pictureStyle || 'abbrev-name',
        });
      }
      const saved = await saveOneButtonPicture(i, png, folder);
      if (saved) files.push(saved);
    }
    this.lastBuilt = build.requestedAt;
    this.lastError = '';
    this.lastOk = `Wrote ${files.length} picture${files.length === 1 ? '' : 's'} to ${folder}`;
    this.emit();
  }
}

module.exports = { BridgeController };
