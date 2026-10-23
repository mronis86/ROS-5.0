const fs = require('fs');
const path = require('path');
const ppt = require('./ppt-com');
const {
  fetchPlaybackManifest,
  fetchPlaybackStatus,
  reportPlaybackLive,
  httpFetch,
} = require('./railway-client');
const { cacheFileName, preferredAssetForItem, decidePlaybackAction } = require('./playback-logic');

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
    this.lastCommandId = null;
    this.lastError = '';
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
      currentItemId: this.currentItemId,
      loadedItemId: this.lastLoadedItemId,
      loadedCueLabel: '',
      lastAction: '',
      lastError: this.lastError,
      error: this.lastError,
      cacheOk: this.cacheRows.filter((r) => r.state === 'ok').length,
      cacheTotal: this.cacheRows.length,
      cacheRows: this.cacheRows,
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

  cacheDir(eventId, itemId) {
    return path.join(this.cacheRoot, String(eventId), String(itemId));
  }

  localPathFor(asset) {
    return path.join(this.cacheDir(this.config.eventId, asset.itemId), cacheFileName(asset.fileId, asset.originalName));
  }

  start(config) {
    this.stop();
    this.config = config || {};
    if (!this.config.eventId) {
      this.lastError = 'Pick an event first.';
      this.emit({ error: this.lastError, message: 'No event' });
      return;
    }
    this.running = true;
    this.lastError = '';
    this.emit({ message: 'Starting ROS PPT Launcher…', error: '' });
    this.tick(true);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
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
      if (forceSync || !this.assets.length) {
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

      await this.followLoadedCue(loadedItemId, loadedCue);

      if (queued && queued.id && queued.id !== this.lastCommandId) {
        await this.runCommand(queued);
      }

      await this.reportAndRefresh();
      this.scheduleNext(700);
    } catch (err) {
      this.lastError = err.message || String(err);
      this.emit({ error: this.lastError, message: 'Playback error' });
      this.scheduleNext(2000);
    } finally {
      this.busy = false;
    }
  }

  async syncCache() {
    const manifest = await fetchPlaybackManifest(
      this.config.apiBaseUrl,
      this.config.apiToken,
      this.config.eventId
    );
    this.assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
    this.cuesWithPpt = Array.isArray(manifest?.cuesWithPpt)
      ? manifest.cuesWithPpt.map((id) => Number(id)).filter((id) => Number.isFinite(id))
      : [];
    const keep = new Set();
    const rows = [];
    for (const asset of this.assets) {
      if (!asset.itemId || !asset.fileId) continue;
      const dest = this.localPathFor(asset);
      keep.add(dest.toLowerCase());
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      let state = 'ok';
      let detail = 'Cached';
      const exists = fs.existsSync(dest);
      const sizeOk =
        exists &&
        asset.sizeBytes != null &&
        Number(asset.sizeBytes) > 0 &&
        fs.statSync(dest).size === Number(asset.sizeBytes);
      if (!exists || (asset.sizeBytes != null && !sizeOk)) {
        if (!asset.downloadUrl) {
          state = 'missing';
          detail = 'No download URL';
        } else {
          try {
            await this.downloadFile(asset.downloadUrl, dest);
            state = exists ? 'replaced' : 'ok';
            detail = exists ? 'Replaced' : 'Downloaded';
          } catch (err) {
            state = 'missing';
            detail = err.message || 'Download failed';
          }
        }
      }
      rows.push({
        fileId: asset.fileId,
        itemId: asset.itemId,
        name: asset.originalName,
        hasPPT: !!asset.hasPPT,
        preferred: !!asset.preferred,
        state,
        detail,
        path: dest,
      });
    }

    const eventRoot = path.join(this.cacheRoot, String(this.config.eventId));
    this.pruneOrphans(eventRoot, keep);
    this.cacheRows = rows;
    this.emit({
      message: `Cache ${rows.filter((r) => r.state === 'ok' || r.state === 'replaced').length}/${rows.length}`,
      lastAction: 'Synced cache',
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

  async followLoadedCue(loadedItemId, loadedCue = null) {
    const cueLabel = loadedCue?.cueLabel || (loadedItemId != null ? `Cue ${loadedItemId}` : '');
    if (loadedItemId == null) {
      this.emit({ loadedCueLabel: '', message: 'No cue loaded' });
      return;
    }
    const asset = preferredAssetForItem(this.assets, loadedItemId);
    const cachedPath = asset ? this.localPathFor(asset) : null;
    const cachedExists = cachedPath && fs.existsSync(cachedPath);
    const hasPPT = this.cuesWithPpt.includes(Number(loadedItemId)) || !!asset?.hasPPT;
    const decision = decidePlaybackAction({
      hasPPT,
      cachedPath: cachedExists ? cachedPath : null,
      currentPath: this.currentPath,
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
        await ppt.closeDeck(this.currentPath);
      } catch (err) {
        this.lastError = err.message || String(err);
      }
      this.currentPath = null;
      this.currentFileId = null;
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
      this.emit({
        loadedCueLabel: cueLabel,
        message: `${cueLabel} · same deck`,
        lastAction: 'Kept deck',
      });
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
      this.emit({
        powerpoint: true,
        slideshowActive: !!result.slideshowActive,
        deckName: result.deckName || path.basename(decision.path),
        slideCount: result.slideCount || 0,
        currentIndex: Number.isFinite(slideIndex) && slideIndex > 0 ? slideIndex : 1,
        loadedCueLabel: cueLabel,
        message: result.showWarning || `${cueLabel} · ${result.deckName || 'deck'} live`,
        lastAction: decision.closePath ? 'Swapped deck' : 'Opened deck',
        error: this.lastError,
      });
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
      currentIndex: Number.isFinite(Number(live.slideIndex)) && Number(live.slideIndex) > 0
        ? Number(live.slideIndex)
        : this.status.currentIndex,
    });
  }

  async reportAndRefresh() {
    let live = null;
    try {
      live = await ppt.getLive();
      if (live && live.ok !== false) this.applyLive(live);
    } catch {
      live = null;
    }
    await reportPlaybackLive(this.config.apiBaseUrl, this.config.apiToken, this.config.eventId, {
      helperMode: 'playback',
      deckName: live?.deckName || this.status.deckName || '',
      slideCount: live?.slideCount || this.status.slideCount || 0,
      slideshowActive: !!(live && live.slideshowActive),
      currentIndex:
        Number.isFinite(Number(live?.slideIndex)) && Number(live.slideIndex) > 0
          ? Number(live.slideIndex)
          : this.status.currentIndex,
      currentItemId: this.currentItemId,
      currentFileId: this.currentFileId,
      cacheOk: this.cacheRows.filter((r) => r.state === 'ok' || r.state === 'replaced').length,
      cacheTotal: this.cacheRows.length,
      lastCommand: this.status.lastAction || '',
      lastCommandId: this.lastCommandId,
      lastError: this.lastError || '',
    });
  }

  async syncNow(config) {
    if (config) this.config = { ...this.config, ...config };
    if (!this.config?.eventId) throw new Error('Pick an event first.');
    return this.syncCache();
  }
}

module.exports = { PlaybackController };
