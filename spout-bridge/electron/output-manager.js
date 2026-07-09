const { BrowserWindow } = require('electron');
const { normalizeBaseUrl } = require('./auth-session');
const { SpoutSender } = require('./spout-sender');
const { extractPaintBitmap } = require('./bitmap-utils');

class OutputManager {
  constructor() {
    this.window = null;
    this.spout = new SpoutSender();
    this.running = false;
    this.frameCount = 0;
    this.captureAttempts = 0;
    this.lastFpsTick = Date.now();
    this.fps = 0;
    this.config = null;
    this.onStatus = null;
    this.frameSubscriptionActive = false;
    this.pixelBuffer = null;
    this.targetFps = 60;
    this._pendingImage = null;
    this._processing = false;
  }

  buildLedUrl(config) {
    const base = normalizeBaseUrl(config.appBaseUrl);
    const eventId = encodeURIComponent(String(config.eventId || '').trim());
    return `${base}/led-output?eventId=${eventId}`;
  }

  async validateApi(config) {
    const base = normalizeBaseUrl(config.apiBaseUrl);
    const eventId = String(config.eventId || '').trim();
    const token = String(config.apiToken || '').trim();
    if (!base || !eventId || !token) {
      return { ok: false, message: 'API URL, event ID, and token are required.' };
    }

    const url = `${base}/api/run-of-show-data/${eventId}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        return { ok: false, message: 'Invalid API token (401).' };
      }
      if (res.status === 403) {
        return { ok: false, message: 'Token cannot access this event (403).' };
      }
      if (!res.ok) {
        return { ok: false, message: `API error ${res.status}.` };
      }
      const data = await res.json();
      const name = data?.event_name || data?.event_id || eventId;
      return { ok: true, message: `Connected — ${name}` };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error' };
    }
  }

  _emitStatus(patch) {
    this.onStatus?.({
      running: this.running,
      fps: this.fps,
      frames: this.frameCount,
      captureAttempts: this.captureAttempts,
      spout: this.spout.statusMessage,
      url: this.config ? this.buildLedUrl(this.config) : '',
      spoutSendsOk: this.spout.sendOkCount ?? 0,
      spoutSendsFailed: this.spout.sendFailCount ?? 0,
      ...patch,
    });
  }

  _stopFrameSubscription() {
    if (this.window && !this.window.isDestroyed() && this.frameSubscriptionActive) {
      try {
        this.window.webContents.endFrameSubscription();
      } catch {
        /* ignore */
      }
      this.frameSubscriptionActive = false;
    }
  }

  _tickFps() {
    const now = Date.now();
    if (now - this.lastFpsTick >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTick = now;
      this._emitStatus();
    }
  }

  _processFrame(image) {
    if (!this.running || !image || !this.spout.ready) return;

    // Always keep only the newest compositor frame — never queue stale frames.
    this._pendingImage = image;
    if (this._processing) return;
    this._drainLatestFrame();
  }

  _drainLatestFrame() {
    if (!this.running || !this._pendingImage) {
      this._processing = false;
      return;
    }

    this._processing = true;
    const image = this._pendingImage;
    this._pendingImage = null;

    this.captureAttempts += 1;
    const frame = extractPaintBitmap(image, this.pixelBuffer);
    if (frame) {
      this.pixelBuffer = frame.buffer;
      const ok = this.spout.sendBitmap(frame.data, frame.width, frame.height);
      if (ok) {
        this.frameCount += 1;
        this._tickFps();
      }
    } else if (this.captureAttempts <= 3) {
      console.warn('[capture] could not read bitmap from frame');
    }

    if (this._pendingImage) {
      setImmediate(() => this._drainLatestFrame());
    } else {
      this._processing = false;
    }
  }

  _startFrameSubscription() {
    this._stopFrameSubscription();
    if (!this.window || this.window.isDestroyed()) return;

    const wc = this.window.webContents;
    this.frameSubscriptionActive = true;

    wc.beginFrameSubscription(false, (image) => {
      this._processFrame(image);
    });
  }

  async start(config) {
    try {
      await this.stop();
      this.config = config;
      this.frameCount = 0;
      this.captureAttempts = 0;
      this.fps = 0;
      this.lastFpsTick = Date.now();
      this.pixelBuffer = null;
      this._pendingImage = null;
      this._processing = false;
      this._stopFrameSubscription();

      const width = Math.max(640, Number(config.width) || 1920);
      const height = Math.max(360, Number(config.height) || 1080);
      const fps = Math.min(60, Math.max(15, Number(config.fps) || 60));
      this.targetFps = fps;

      let ledUrl;
      try {
        ledUrl = this.buildLedUrl(config);
        new URL(ledUrl);
      } catch {
        return {
          ok: false,
          message: `Invalid hosted app URL: "${config.appBaseUrl}" (use http://localhost:3003)`,
        };
      }

      // Init Spout in-process (no 8MB stdin pipe — major latency win vs worker).
      const spoutOk = this.spout.init(config.spoutName);
      if (!spoutOk) {
        return { ok: false, message: this.spout.statusMessage || 'Spout init failed' };
      }

      this.window = new BrowserWindow({
        width,
        height,
        show: true,
        x: -24000,
        y: -24000,
        skipTaskbar: true,
        frame: false,
        focusable: false,
        useContentSize: true,
        backgroundColor: '#000000',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false,
        },
      });

      this.window.setMenuBarVisibility(false);
      this.window.webContents.setZoomFactor(1);
      this.window.webContents.setFrameRate(fps);

      this.window.webContents.on('did-fail-load', (_e, code, desc, url) => {
        console.warn('[led-output] load failed:', code, desc, url);
        this._emitStatus({ error: `Page load failed (${code}): ${desc}` });
      });

      this.window.webContents.on('console-message', (_e, level, message) => {
        if (level >= 2) {
          console.warn('[led-output]', message);
        }
      });

      this.running = true;

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('LED page load timeout (15s)')), 15000);
        this.window.webContents.once('did-finish-load', () => {
          clearTimeout(timeout);
          console.log('[led-output] page loaded:', ledUrl);
          resolve();
        });
        this.window.loadURL(ledUrl).catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      this._startFrameSubscription();
      console.log('[capture] in-process Spout + compositor frames (low latency)');

      this._emitStatus({ message: 'LED output running', url: ledUrl });
      return { ok: true, url: ledUrl };
    } catch (err) {
      await this.stop();
      return { ok: false, message: err.message || 'Start failed' };
    }
  }

  async stop() {
    this.running = false;
    this._pendingImage = null;
    this._processing = false;
    this._stopFrameSubscription();
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
    this.pixelBuffer = null;
    this.spout.dispose();
    this.spout = new SpoutSender();
    this._emitStatus({ message: 'Stopped' });
  }
}

module.exports = { OutputManager };
