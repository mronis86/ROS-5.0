const fs = require('fs');
const path = require('path');
const ppt = require('./ppt-com');
const {
  fetchPlaybackManifest,
  fetchPlaybackStatus,
  reportPlaybackLive,
  uploadPlaybackPreviews,
  httpFetch,
} = require('./railway-client');
const {
  preferredAssetForItem,
  decidePlaybackAction,
  syncFileName,
  shouldReplaceLocalFile,
} = require('./playback-logic');

const MANIFEST_NAME = 'ros-ppt-sync.json';
const SYNC_EVERY_MS = 15 * 1000;

class PlaybackController {
  constructor({ onStatus, cacheRoot } = {}) {
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.cacheRoot = cacheRoot;
    this.running = false;
    this.config = null;
    this.timer = null;
    this.busy = false;
    this.assets = [];
    this.cuesWithPpt = [];
    this.cacheRows = [];
    this.currentPath = null;
    this.currentFileId = null;
    this.currentItemId = null;
    this.lastLoadedItemId = null;
    this.lastStartedItemId = null;
    this.lastCommandId = null;
    this.lastError = '';
    this.lastSyncAt = 0;
    this.lastLiveKey = '';
    this.lastReportAt = 0;
    this.previewPath = '';
    this.previewBusy = false;
    this.liveTimer = null;
    this.manifest = { files: {} };
    this.status = this.blankStatus('Stopped');
  }

  blankStatus(message) {
    return {
      mode: 'playback',
      running: this.running,
      message: message || '',
      powerpoint: false,
      slideshowActive: false,
      deckName: '',
      slideCount: 0,
      currentSlideId: null,
      currentIndex: null,
      livePath: '',
      currentItemId: this.currentItemId,
      loadedItemId: this.lastLoadedItemId,
      loadedCueLabel: '',
      lastAction: '',
      lastError: this.lastError,
      error: this.lastError,
      cacheOk: this.cacheRows.filter((r) => r.state === 'ok').length,
      cacheTotal: this.cacheRows.length,
      cacheRows: this.cacheRows,
      syncFolder: this.config?.syncFolder || '',
    };
  }

  emit(partial) {
    this.status = {
      ...this.blankStatus(partial?.message || this.status.message),
      ...this.status,
      ...partial,
      mode: 'playback',
      running: this.running,
      cacheOk: this.cacheRows.filter((r) => r.state === 'ok').length,
      cacheTotal: this.cacheRows.length,
      cacheRows: this.cacheRows,
      currentItemId: this.currentItemId,
      loadedItemId: this.lastLoadedItemId,
      lastError: this.lastError,
      error: partial?.error != null ? partial.error : this.lastError,
    };
    this.onStatus(this.status);
  }

  syncDir() {
    const root = String(this.config?.syncFolder || '').trim();
    if (!root) {
      const err = new Error('Pick a sync folder for ROS PPT Launcher.');
      err.statusCode = 400;
      throw err;
    }
    return path.join(root, String(this.config.eventId || 'event'));
  }

  manifestPath() {
    return path.join(this.syncDir(), MANIFEST_NAME);
  }

  readManifest() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.manifestPath(), 'utf8'));
      this.manifest = raw && typeof raw === 'object' ? raw : { files: {} };
      if (!this.manifest.files || typeof this.manifest.files !== 'object') this.manifest.files = {};
    } catch {
      this.manifest = { files: {} };
    }
    return this.manifest;
  }

  writeManifest() {
    const dir = this.syncDir();
    fs.mkdirSync(dir, { recursive: true });
    this.manifest.eventId = this.config.eventId;
    this.manifest.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.manifestPath(), JSON.stringify(this.manifest, null, 2), 'utf8');
  }

  localPathFor(asset, cueLabel) {
    const itemKey = String(asset.itemId);
    const recorded = this.manifest?.files?.[itemKey];
    const fileName = recorded?.localName || syncFileName(asset, cueLabel);
    return path.join(this.syncDir(), fileName);
  }

  start(config) {
    this.stop();
    this.config = config || {};
    if (!this.config.eventId) {
      this.lastError = 'Pick an event first.';
      this.emit({ error: this.lastError, message: 'No event' });
      return;
    }
    if (!String(this.config.syncFolder || '').trim()) {
      this.lastError = 'Pick a sync folder, then Sync decks.';
      this.emit({ error: this.lastError, message: 'No sync folder' });
      return;
    }
    this.running = true;
    this.lastError = '';
    this.emit({ message: 'Starting ROS PPT Launcher…', error: '' });
    try { ppt.startLiveWatch(); } catch { /* ignore */ }
    this.pollLive(true);
    this.tick(true);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.liveTimer) {
      clearTimeout(this.liveTimer);
      this.liveTimer = null;
    }
    try { ppt.stopLiveWatch(); } catch { /* ignore */ }
    this.emit({ message: 'Stopped', slideshowActive: false });
  }

  scheduleNext(ms) {
    if (this.timer) clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(() => this.tick(false), ms);
  }

  async tick(forceSync) {
    if (!this.running || this.busy) {
      if (this.running && this.busy) this.scheduleNext(400);
      return;
    }
    this.busy = true;
    try {
      if (forceSync || !this.assets.length || Date.now() - this.lastSyncAt > SYNC_EVERY_MS) {
        await this.syncCache();
      }
      const playback = await fetchPlaybackStatus(
        this.config.apiBaseUrl,
        this.config.apiToken,
        this.config.eventId
      );
      const loadedItemId = playback?.session?.loadedItemId ?? playback?.session?.loadedCue?.itemId ?? null;
      const loadedCue = playback?.session?.loadedCue || null;
      const queued = playback?.session?.queuedCommand || null;
      let livePath = this.status.livePath || null;
      let slideshowActive = !!this.status.slideshowActive;
      try {
        const live = await ppt.getLive();
        if (live && live.ok !== false) {
          livePath = live.fullName || live.full_name || null;
          slideshowActive = !!live.slideshowActive;
          this.applyLive(live);
        }
      } catch {
        livePath = this.status.livePath || null;
      }

      await this.followLoadedCue(loadedItemId, loadedCue, livePath, slideshowActive);

      if (queued && queued.id && queued.id !== this.lastCommandId) {
        await this.runCommand(queued);
        await this.reportAndRefresh(true);
      }

      this.scheduleNext(1200);
    } catch (err) {
      this.lastError = err.message || String(err);
      this.emit({ error: this.lastError, message: 'Playback error' });
      this.scheduleNext(2000);
    } finally {
      this.busy = false;
    }
  }

  async syncCache() {
    const remote = await fetchPlaybackManifest(
      this.config.apiBaseUrl,
      this.config.apiToken,
      this.config.eventId
    );
    this.assets = Array.isArray(remote?.assets) ? remote.assets : [];
    this.cuesWithPpt = Array.isArray(remote?.cuesWithPpt)
      ? remote.cuesWithPpt.map((id) => Number(id)).filter((id) => Number.isFinite(id))
      : [];
    const dir = this.syncDir();
    fs.mkdirSync(dir, { recursive: true });
    this.readManifest();
    const keep = new Set([this.manifestPath().toLowerCase()]);
    const nextFiles = {};
    const rows = [];

    for (const asset of this.assets) {
      if (!asset.itemId || !asset.fileId) continue;
      const itemKey = String(asset.itemId);
      const localName = syncFileName(asset, `Cue ${asset.itemId}`);
      const dest = path.join(dir, localName);
      const previous = this.manifest.files[itemKey] || {};
      const previousPath = previous.localName ? path.join(dir, previous.localName) : dest;
      keep.add(dest.toLowerCase());
      let state = 'ok';
      let detail = 'Synced';
      const replace = shouldReplaceLocalFile(
        {
          fileId: previous.fileId,
          sizeBytes: previous.sizeBytes ?? (fs.existsSync(dest) ? fs.statSync(dest).size : null),
          path: previousPath,
        },
        { fileId: asset.fileId, sizeBytes: asset.sizeBytes }
      );
      if (replace) {
        if (!asset.downloadUrl) {
          state = 'missing';
          detail = 'No download URL';
        } else {
          try {
            if (previousPath && previousPath.toLowerCase() !== dest.toLowerCase() && fs.existsSync(previousPath)) {
              try { fs.unlinkSync(previousPath); } catch { /* ignore */ }
            }
            await this.downloadFile(asset.downloadUrl, dest);
            state = previous.fileId ? 'replaced' : 'ok';
            detail = previous.fileId ? 'Replaced newer version' : 'Downloaded';
          } catch (err) {
            state = 'missing';
            detail = err.message || 'Download failed';
          }
        }
      }
      nextFiles[itemKey] = {
        fileId: asset.fileId,
        sizeBytes: asset.sizeBytes ?? (fs.existsSync(dest) ? fs.statSync(dest).size : null),
        localName,
        originalName: asset.originalName,
      };
      rows.push({
        fileId: asset.fileId,
        itemId: asset.itemId,
        name: asset.originalName,
        localName,
        hasPPT: !!asset.hasPPT,
        preferred: !!asset.preferred,
        state,
        detail,
        path: dest,
      });
    }

    this.manifest.files = nextFiles;
    this.writeManifest();
    this.pruneOrphans(dir, keep);
    this.cacheRows = rows;
    this.lastSyncAt = Date.now();
    this.emit({
      message: `Synced ${rows.filter((r) => r.state === 'ok' || r.state === 'replaced').length}/${rows.length} decks`,
      lastAction: 'Synced folder',
      syncFolder: this.config.syncFolder,
    });
    return rows;
  }

  pruneOrphans(root, keep) {
    if (!fs.existsSync(root)) return;
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
          if (!fs.readdirSync(full).length) {
            try {
              fs.rmdirSync(full);
            } catch {
              /* ignore */
            }
          }
        } else if (!keep.has(full.toLowerCase())) {
          try {
            fs.unlinkSync(full);
          } catch {
            /* ignore */
          }
        }
      }
    };
    walk(root);
  }

  async downloadFile(url, dest) {
    const res = await httpFetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const tmp = `${dest}.part`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);
    try {
      fs.unlinkSync(`${dest}:Zone.Identifier`);
    } catch {
      /* no MOTW stream */
    }
  }

  async followLoadedCue(loadedItemId, loadedCue = null, livePath = null, slideshowActive = false) {
    const cueLabel = loadedCue?.cueLabel || (loadedItemId != null ? `Cue ${loadedItemId}` : '');
    const timerState = loadedCue?.timerState || null;
    if (loadedItemId == null) {
      this.emit({ loadedCueLabel: '', message: 'No cue loaded' });
      return;
    }
    const asset = preferredAssetForItem(this.assets, loadedItemId);
    const cachedPath = asset ? this.localPathFor(asset, cueLabel) : null;
    const cachedExists = cachedPath && fs.existsSync(cachedPath);
    const hasPPT = this.cuesWithPpt.includes(Number(loadedItemId)) || !!asset?.hasPPT;
    const decision = decidePlaybackAction({
      hasPPT,
      cachedPath: cachedExists ? cachedPath : null,
      currentPath: this.currentPath,
      livePath,
      timerState,
      slideshowActive,
    });

    if (decision.action === 'idle') {
      this.lastLoadedItemId = loadedItemId;
      this.emit({
        loadedCueLabel: cueLabel,
        message: `${cueLabel} loaded · no PPT`,
        lastAction: 'No PPT',
      });
      return;
    }
    if (decision.action === 'warn') {
      this.lastError = decision.warning;
      this.emit({
        loadedCueLabel: cueLabel,
        error: this.lastError,
        message: `${cueLabel}: PPT checked, no cached deck`,
        lastAction: 'Missing deck',
      });
      return;
    }
    if (decision.action === 'close') {
      try {
        await ppt.closeAll();
      } catch (err) {
        this.lastError = err.message || String(err);
      }
      this.currentPath = null;
      this.currentFileId = null;
      this.previewPath = '';
      this.currentItemId = loadedItemId;
      this.lastLoadedItemId = loadedItemId;
      this.emit({
        loadedCueLabel: cueLabel,
        message: `${cueLabel} · closed PowerPoint`,
        lastAction: 'Closed deck',
      });
      return;
    }
    if (decision.action === 'keep') {
      this.lastLoadedItemId = loadedItemId;
      this.currentItemId = loadedItemId;
      this.currentPath = decision.path || this.currentPath;
      this.emit({
        loadedCueLabel: cueLabel,
        message: `${cueLabel} · matching deck ready`,
        lastAction: 'Matching deck',
      });
      return;
    }
    if (decision.action === 'run') {
      this.lastLoadedItemId = loadedItemId;
      this.currentItemId = loadedItemId;
      this.currentPath = decision.path || this.currentPath;
      if (this.lastStartedItemId === loadedItemId && this.status.slideshowActive) {
        this.emit({
          loadedCueLabel: cueLabel,
          message: `${cueLabel} · slideshow live`,
          lastAction: 'Slideshow live',
        });
        return;
      }
      try {
        const started = await ppt.startShow(this.currentPath);
        if (started && started.ok !== false) this.applyLive(started);
        this.lastStartedItemId = loadedItemId;
        this.lastError = '';
        this.emit({
          loadedCueLabel: cueLabel,
          message: `${cueLabel} · started slideshow`,
          lastAction: 'Started slideshow',
          error: '',
        });
      } catch (err) {
        this.lastError = err.message || 'Could not start slideshow';
        this.emit({
          loadedCueLabel: cueLabel,
          error: this.lastError,
          message: `${cueLabel} · deck matched, slideshow failed`,
          lastAction: 'Start failed',
        });
      }
      return;
    }
    if (decision.action === 'swap') {
      let result;
      try {
        result = await ppt.swapDeck(decision.path, decision.closePath);
      } catch (err) {
        this.lastError = err.message || 'Could not open deck';
        this.emit({
          loadedCueLabel: cueLabel,
          error: this.lastError,
          message: `${cueLabel} · PowerPoint open failed`,
          lastAction: 'Open failed',
        });
        return;
      }
      if (!result || result.ok === false) {
        this.lastError = result?.error || 'Could not open deck';
        this.emit({
          loadedCueLabel: cueLabel,
          error: this.lastError,
          message: `${cueLabel} · PowerPoint open failed`,
          lastAction: 'Open failed',
        });
        return;
      }
      this.currentPath = decision.path;
      this.currentFileId = asset?.fileId || null;
      this.currentItemId = loadedItemId;
      this.lastLoadedItemId = loadedItemId;
      this.lastError = result.showWarning || '';
      const slideIndex = Number(result.slideIndex);
      if (!result.slideshowActive) {
        try {
          const started = await ppt.startShow(this.currentPath);
          if (started && started.ok !== false) {
            this.applyLive(started);
            result.slideshowActive = !!started.slideshowActive;
            this.lastStartedItemId = loadedItemId;
          }
        } catch (err) {
          this.lastError = err.message || result.showWarning || '';
        }
      } else {
        this.lastStartedItemId = loadedItemId;
      }
      this.emit({
        powerpoint: true,
        slideshowActive: !!result.slideshowActive || timerState === 'running',
        deckName: result.deckName || path.basename(decision.path),
        slideCount: result.slideCount || 0,
        currentIndex: Number.isFinite(slideIndex) && slideIndex > 0 ? slideIndex : 1,
        loadedCueLabel: cueLabel,
        message: result.showWarning || `${cueLabel} · ${result.deckName || 'deck'} from sync folder`,
        lastAction: decision.startShow ? 'Opened and ran cue deck' : 'Opened cue deck',
        error: this.lastError,
      });
      void this.captureAndUploadPreviews(decision.path);
      await this.reportAndRefresh(true);
    }
  }

  async runCommand(command) {
    const action = String(command.action || '').toLowerCase();
    let result = null;
    if (action === 'next') result = await ppt.nextSlide();
    else if (action === 'prev') result = await ppt.prevSlide();
    else if (action === 'goto') result = await ppt.gotoSlide(command.slideIndex);
    else if (action === 'start') result = await ppt.startShow(this.currentPath);
    else if (action === 'end') result = await ppt.endShow();
    else return;
    if (!result || result.ok === false) {
      this.lastError = result?.error || `Command ${action} failed`;
    } else {
      this.lastError = '';
      this.applyLive(result);
    }
    this.lastCommandId = command.id;
    this.emit({ lastAction: `Web ${action}`, error: this.lastError });
  }

  applyLive(live) {
    if (!live || live.ok === false) return;
    this.emit({
      powerpoint: true,
      slideshowActive: !!live.slideshowActive,
      deckName: live.deckName || this.status.deckName,
      slideCount: live.slideCount || this.status.slideCount,
      livePath: live.fullName || live.full_name || this.status.livePath,
      currentIndex: Number.isFinite(Number(live.slideIndex)) && Number(live.slideIndex) > 0
        ? Number(live.slideIndex)
        : this.status.currentIndex,
    });
  }

  liveFingerprint() {
    return [
      this.status.livePath || '',
      this.status.currentIndex || '',
      this.status.slideshowActive ? '1' : '0',
      this.status.slideCount || 0,
      this.currentItemId || '',
    ].join('|');
  }

  scheduleLive(ms) {
    if (this.liveTimer) clearTimeout(this.liveTimer);
    if (!this.running) return;
    this.liveTimer = setTimeout(() => this.pollLive(false), ms);
  }

  async pollLive(forceReport) {
    if (!this.running) return;
    try {
      const live = await ppt.getLive();
      if (live && live.ok !== false) this.applyLive(live);
      const key = this.liveFingerprint();
      const changed = key !== this.lastLiveKey;
      if (forceReport || changed || Date.now() - this.lastReportAt > 2000) {
        await this.reportAndRefresh(false);
        this.lastLiveKey = key;
      }
    } catch {
      /* next poll */
    }
    this.scheduleLive(this.status.slideshowActive ? 220 : 500);
  }

  async captureAndUploadPreviews(filePath) {
    if (!filePath || this.previewBusy || this.previewPath === filePath) return;
    this.previewBusy = true;
    try {
      const stills = await ppt.captureStills();
      if (!stills || stills.ok === false || !Array.isArray(stills.slides) || !stills.slides.length) {
        return;
      }
      await uploadPlaybackPreviews(this.config.apiBaseUrl, this.config.apiToken, this.config.eventId, {
        fileId: this.currentFileId,
        deckName: stills.deckName || this.status.deckName,
        slides: stills.slides,
      });
      this.previewPath = filePath;
      this.emit({
        slideCount: stills.slideCount || stills.slides.length,
        lastAction: `Captured ${stills.slides.length} slide previews`,
      });
      await this.reportAndRefresh(true);
    } catch (err) {
      this.lastError = err.message || 'Could not capture slide previews';
      this.emit({ error: this.lastError });
    } finally {
      this.previewBusy = false;
    }
  }

  async reportAndRefresh(_unusedLive) {
    await reportPlaybackLive(this.config.apiBaseUrl, this.config.apiToken, this.config.eventId, {
      helperMode: 'playback',
      deckName: this.status.deckName || '',
      slideCount: this.status.slideCount || 0,
      slideshowActive: !!this.status.slideshowActive,
      currentIndex: this.status.currentIndex,
      currentItemId: this.currentItemId,
      currentFileId: this.currentFileId,
      cacheOk: this.cacheRows.filter((r) => r.state === 'ok' || r.state === 'replaced').length,
      cacheTotal: this.cacheRows.length,
      lastCommand: this.status.lastAction || '',
      lastCommandId: this.lastCommandId,
      lastError: this.lastError || '',
    });
    this.lastReportAt = Date.now();
  }

  async syncNow(config) {
    if (config) this.config = { ...this.config, ...config };
    if (!this.config?.eventId) throw new Error('Pick an event first.');
    if (!String(this.config.syncFolder || '').trim()) throw new Error('Pick a sync folder first.');
    return this.syncCache();
  }
}

module.exports = { PlaybackController };
