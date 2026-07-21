const { BrowserWindow } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { normalizeBaseUrl } = require('./auth-session');
const { SpoutSender } = require('./spout-sender');
const { extractPaintBitmap } = require('./bitmap-utils');
const { createCueFollower } = require('./cue-follower');
const {
  loadManifest,
  resolvePlayFileUrl,
  resolveStillFileUrl,
  findCue,
} = require('./prerender-pack');

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
    this._pendingNativeImage = null;
    this._lastFrame = null;
    this._publishLoop = null;
    this._cueFollower = null;
    this._pack = null;
    this._activeCueId = null;
  }

  buildLedUrl(config) {
    const base = normalizeBaseUrl(config.appBaseUrl);
    const eventId = encodeURIComponent(String(config.eventId || '').trim());
    return `${base}/led-output?eventId=${eventId}&key=1`;
  }

  isPrerenderMode(config) {
    return String(config?.sourceMode || 'live').toLowerCase() === 'prerender';
  }

  async validateApi(config) {
    if (this.isPrerenderMode(config)) {
      try {
        const { manifest, root } = loadManifest(config.prerenderPackPath);
        const count = Object.keys(manifest.cues || {}).length;
        const name = manifest.eventName || manifest.eventId || path.basename(root);
        return { ok: true, message: `Prerender pack — ${name} (${count} cues)` };
      } catch (err) {
        return { ok: false, message: err.message || 'Invalid prerender pack' };
      }
    }

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
    const source = this.config && this.isPrerenderMode(this.config) ? 'prerender' : 'live';
    this.onStatus?.({
      running: this.running,
      fps: this.fps,
      targetFps: this.targetFps,
      frames: this.frameCount,
      captureAttempts: this.captureAttempts,
      spout: this.spout.statusMessage,
      url: this.config
        ? source === 'prerender'
          ? `prerender:${this.config.prerenderPackPath || ''}`
          : this.buildLedUrl(this.config)
        : '',
      sourceMode: source,
      activeCueId: this._activeCueId,
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

  _stopPublishLoop() {
    if (this._publishLoop) {
      clearInterval(this._publishLoop);
      this._publishLoop = null;
    }
  }

  _stopCueFollower() {
    if (this._cueFollower) {
      this._cueFollower.dispose();
      this._cueFollower = null;
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

  _onCompositorFrame(image) {
    if (!this.running || !image) return;
    this._pendingNativeImage = image;
  }

  _publishTick() {
    if (!this.running || !this.spout.ready) return;

    if (this._pendingNativeImage) {
      const image = this._pendingNativeImage;
      this._pendingNativeImage = null;
      this.captureAttempts += 1;

      const frame = extractPaintBitmap(image, this.pixelBuffer);
      if (frame) {
        this.pixelBuffer = frame.buffer;
        this._lastFrame = {
          width: frame.width,
          height: frame.height,
          data: frame.data,
        };
      }
    }

    if (!this._lastFrame) return;

    const ok = this.spout.sendBitmap(
      this._lastFrame.data,
      this._lastFrame.width,
      this._lastFrame.height
    );
    if (ok) {
      this.frameCount += 1;
      this._tickFps();
    }
  }

  _startPublishLoop(fps) {
    this._stopPublishLoop();
    const intervalMs = Math.max(1, Math.floor(1000 / fps));
    this._publishLoop = setInterval(() => this._publishTick(), intervalMs);
  }

  _startFrameSubscription() {
    this._stopFrameSubscription();
    if (!this.window || this.window.isDestroyed()) return;

    const wc = this.window.webContents;
    this.frameSubscriptionActive = true;

    wc.beginFrameSubscription(false, (image) => {
      this._onCompositorFrame(image);
    });
  }

  async _playPrerenderCue(itemId) {
    if (!this.window || this.window.isDestroyed() || !this._pack) return;
    const cue = findCue(this._pack.manifest, itemId);
    if (!cue) {
      this._emitStatus({
        warning: `No prerender file for cue ${itemId}`,
      });
      return;
    }
    const fileUrl = resolvePlayFileUrl(this._pack.root, cue);
    if (!fileUrl) {
      this._emitStatus({
        warning: `Missing enter prerender for cue ${itemId}`,
      });
      return;
    }
    const stillUrl = resolveStillFileUrl(this._pack.root, cue);
    const durationMs = Math.max(
      0,
      Number(cue?.durationMs?.clip ?? cue?.durationMs?.enter) || 0
    );
    const format = String(
      cue?.format || path.extname(new URL(fileUrl).pathname).slice(1)
    ).toLowerCase();
    this._activeCueId = itemId;
    await this.window.webContents.executeJavaScript(
      `window.rosPrerenderPlayer && window.rosPrerenderPlayer.playEnter(` +
        `${JSON.stringify(fileUrl)}, ${JSON.stringify({
          stillUrl,
          durationMs,
          format,
        })})`
        + `)`
    );
    this._emitStatus({ message: `Playing enter prerender cue ${itemId}` });
  }

  async _clearPrerenderCue() {
    this._activeCueId = null;
    if (!this.window || this.window.isDestroyed()) return;
    await this.window.webContents.executeJavaScript(
      `window.rosPrerenderPlayer && window.rosPrerenderPlayer.clearCue()`
    );
    this._emitStatus({ message: 'Prerender cleared (idle)' });
  }

  _createCaptureWindow(width, height, fps) {
    this.window = new BrowserWindow({
      width,
      height,
      show: true,
      x: -24000,
      y: -24000,
      skipTaskbar: true,
      frame: false,
      focusable: false,
      transparent: true,
      useContentSize: true,
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
        webSecurity: false,
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
  }

  async _loadUrl(url) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('LED page load timeout (15s)')), 15000);
      this.window.webContents.once('did-finish-load', () => {
        clearTimeout(timeout);
        console.log('[led-output] page loaded:', url);
        resolve();
      });
      this.window.loadURL(url).catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
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
      this._pendingNativeImage = null;
      this._lastFrame = null;
      this._pack = null;
      this._activeCueId = null;
      this._stopFrameSubscription();
      this._stopPublishLoop();
      this._stopCueFollower();

      const width = Math.max(640, Number(config.width) || 1920);
      const height = Math.max(360, Number(config.height) || 1080);
      // Default output is locked to 60 Hz/FPS. Checkbox opts into the field.
      const fps = config.useSelectedFps
        ? Math.min(60, Math.max(15, Number(config.fps) || 60))
        : 60;
      this.targetFps = fps;

      const spoutOk = await this.spout.init(config.spoutName);
      if (!spoutOk) {
        return { ok: false, message: this.spout.statusMessage || 'Spout init failed' };
      }

      this._createCaptureWindow(width, height, fps);
      this.running = true;

      if (this.isPrerenderMode(config)) {
        let pack;
        try {
          pack = loadManifest(config.prerenderPackPath);
        } catch (err) {
          await this.stop();
          return { ok: false, message: err.message || 'Invalid prerender pack' };
        }
        this._pack = pack;

        const playerPath = path.join(__dirname, '..', 'renderer', 'prerender-player.html');
        const playerUrl = pathToFileURL(playerPath).href;
        await this._loadUrl(playerUrl);

        const offlineUrl = normalizeBaseUrl(config.offlineShowUrl || 'http://127.0.0.1:3004');
        const eventId = String(config.eventId || pack.manifest.eventId || '').trim();
        if (!eventId) {
          await this.stop();
          return { ok: false, message: 'Event ID required for prerender cue follow' };
        }

        let ioClient;
        try {
          ioClient = require('socket.io-client');
        } catch {
          await this.stop();
          return {
            ok: false,
            message: 'socket.io-client missing — run npm install in spout-bridge/',
          };
        }

        this._cueFollower = createCueFollower({
          ioClient,
          url: offlineUrl,
          eventId,
          onPlayCue: (itemId) => {
            this._playPrerenderCue(itemId).catch((err) => {
              this._emitStatus({ warning: err.message || 'Play failed' });
            });
          },
          onClear: () => {
            this._clearPrerenderCue().catch(() => {});
          },
          onStatus: (status) => {
            this._emitStatus({
              message: status.message,
              warning: status.ok ? undefined : status.message,
            });
          },
        });

        this._startFrameSubscription();
        this._startPublishLoop(fps);
        this._emitStatus({
          message: `Prerender mode — ${Object.keys(pack.manifest.cues || {}).length} cues`,
          url: `prerender:${pack.root}`,
        });
        return { ok: true, url: `prerender:${pack.root}` };
      }

      let ledUrl;
      try {
        ledUrl = this.buildLedUrl(config);
        new URL(ledUrl);
      } catch {
        await this.stop();
        return {
          ok: false,
          message: `Invalid hosted app URL: "${config.appBaseUrl}" (use http://localhost:3003)`,
        };
      }

      await this._loadUrl(ledUrl);
      this._startFrameSubscription();
      this._startPublishLoop(fps);
      console.log(`[capture] Spout publish loop @ ${fps} fps (compositor-fed, frame hold)`);

      this._emitStatus({ message: 'LED output running', url: ledUrl });
      return { ok: true, url: ledUrl };
    } catch (err) {
      await this.stop();
      return { ok: false, message: err.message || 'Start failed' };
    }
  }

  async stop() {
    this.running = false;
    this._pendingNativeImage = null;
    this._lastFrame = null;
    this._activeCueId = null;
    this._pack = null;
    this._stopPublishLoop();
    this._stopFrameSubscription();
    this._stopCueFollower();
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
