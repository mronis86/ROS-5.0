const fs = require('fs');
const path = require('path');
const ppt = require('./ppt-com');
const {
  fetchPlaybackManifest,
  fetchPlaybackStatus,
  fetchPlaybackAsset,
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
    this.manualHold = false;
    this.closedByOperator = false;
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
      if (forceSync || !this.assets.length) {
        await this.syncCache({ missingOnly: true });
      }
      const playback = await fetchPlaybackStatus(
        this.config.apiBaseUrl,
        this.config.apiToken,
        this.config.eventId
      );
      this.mergePreferredFiles(playback?.preferredFiles);
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

  cacheFilesList() {
    this.readManifest();
    return Object.entries(this.manifest.files || {})
      .map(([itemId, row]) => ({
        itemId: Number(itemId),
        fileId: row?.fileId ? String(row.fileId) : '',
      }))
      .filter((row) => Number.isFinite(row.itemId) && row.fileId);
  }

  mergePreferredFiles(preferred) {
    if (!Array.isArray(preferred) || !preferred.length) return;
    for (const row of preferred) {
      const itemId = Number(row?.itemId);
      const fileId = row?.fileId != null ? String(row.fileId) : '';
      if (!Number.isFinite(itemId) || !fileId) continue;
      const existing = (this.assets || []).find((asset) => Number(asset.itemId) === itemId && asset.preferred);
      if (existing) {
        existing.fileId = fileId;
        existing.originalName = row.originalName || existing.originalName;
        existing.sizeBytes = row.sizeBytes != null ? Number(row.sizeBytes) : existing.sizeBytes;
      } else {
        this.assets.push({
          itemId,
          fileId,
          originalName: row.originalName || 'deck.pptx',
          sizeBytes: row.sizeBytes != null ? Number(row.sizeBytes) : null,
          preferred: true,
          hasPPT: true,
          downloadUrl: null,
        });
      }
    }
  }

  isLiveOpenItem(itemId) {
    return !!(
      this.currentPath &&
      itemId != null &&
      Number(itemId) === Number(this.currentItemId)
    );
  }

  async syncCache(opts = {}) {
    const replace = opts.replace === true;
    const missingOnly = opts.missingOnly === true;
    const onlyItemId = opts.onlyItemId != null ? Number(opts.onlyItemId) : null;
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
      let state = fs.existsSync(dest) || fs.existsSync(previousPath) ? 'ok' : 'missing';
      let detail = state === 'ok' ? 'Synced' : 'Not on disk';
      const needsReplace = shouldReplaceLocalFile(
        {
          fileId: previous.fileId,
          sizeBytes: previous.sizeBytes ?? (fs.existsSync(dest) ? fs.statSync(dest).size : null),
          path: previousPath,
        },
        { fileId: asset.fileId, sizeBytes: asset.sizeBytes }
      );
      const missing = !fs.existsSync(dest) && !fs.existsSync(previousPath);
      const targeted = Number.isFinite(onlyItemId) && Number(asset.itemId) === onlyItemId;
      const shouldDownload =
        needsReplace &&
        !this.isLiveOpenItem(asset.itemId) &&
        (replace || targeted || (missingOnly && missing));
      if (needsReplace && !shouldDownload) {
        state = previous.fileId && String(previous.fileId) !== String(asset.fileId) ? 'newer' : state;
        detail = this.isLiveOpenItem(asset.itemId)
          ? 'Open deck stays as-is'
          : 'Newer version waiting for Push';
        nextFiles[itemKey] = {
          fileId: previous.fileId || asset.fileId,
          sizeBytes: previous.sizeBytes ?? (fs.existsSync(previousPath) ? fs.statSync(previousPath).size : null),
          localName: previous.localName || localName,
          originalName: previous.originalName || asset.originalName,
        };
      } else if (shouldDownload) {
        if (!asset.downloadUrl) {
          state = 'missing';
          detail = 'No download URL';
          nextFiles[itemKey] = {
            fileId: previous.fileId || asset.fileId,
            sizeBytes: previous.sizeBytes ?? null,
            localName: previous.localName || localName,
            originalName: previous.originalName || asset.originalName,
          };
        } else {
          try {
            if (previousPath && previousPath.toLowerCase() !== dest.toLowerCase() && fs.existsSync(previousPath)) {
              try { fs.unlinkSync(previousPath); } catch { /* ignore */ }
            }
            await this.downloadFile(asset.downloadUrl, dest);
            state = previous.fileId ? 'replaced' : 'ok';
            detail = previous.fileId ? 'Replaced newer version' : 'Downloaded';
            nextFiles[itemKey] = {
              fileId: asset.fileId,
              sizeBytes: asset.sizeBytes ?? (fs.existsSync(dest) ? fs.statSync(dest).size : null),
              localName,
              originalName: asset.originalName,
            };
          } catch (err) {
            state = 'missing';
            detail = err.message || 'Download failed';
            nextFiles[itemKey] = {
              fileId: previous.fileId || asset.fileId,
              sizeBytes: previous.sizeBytes ?? null,
              localName: previous.localName || localName,
              originalName: previous.originalName || asset.originalName,
            };
          }
        }
      } else {
        nextFiles[itemKey] = {
          fileId: previous.fileId || asset.fileId,
          sizeBytes: previous.sizeBytes ?? (fs.existsSync(dest) ? fs.statSync(dest).size : null),
          localName: previous.localName || localName,
          originalName: previous.originalName || asset.originalName,
        };
      }
      rows.push({
        fileId: nextFiles[itemKey].fileId,
        itemId: asset.itemId,
        name: asset.originalName,
        localName: nextFiles[itemKey].localName,
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

  async syncOne(itemId, fileId) {
    if (this.isLiveOpenItem(itemId)) {
      this.emit({ lastAction: 'Skipped live deck', message: 'Open deck stays as-is' });
      return { skipped: true };
    }
    let asset = null;
    if (fileId) {
      try {
        asset = await fetchPlaybackAsset(
          this.config.apiBaseUrl,
          this.config.apiToken,
          this.config.eventId,
          fileId
        );
      } catch {
        asset = null;
      }
    }
    if (!asset?.downloadUrl) {
      const rows = await this.syncCache({
        replace: false,
        onlyItemId: Number.isFinite(Number(itemId)) ? Number(itemId) : null,
      });
      return { rows };
    }
    this.mergePreferredFiles([asset]);
    const cueLabel = `Cue ${asset.itemId || itemId}`;
    const dest = this.localPathFor(asset, cueLabel);
    this.readManifest();
    const itemKey = String(asset.itemId || itemId);
    const previous = this.manifest.files[itemKey] || {};
    const previousPath = previous.localName ? path.join(this.syncDir(), previous.localName) : dest;
    if (previousPath && previousPath.toLowerCase() !== dest.toLowerCase() && fs.existsSync(previousPath)) {
      try { fs.unlinkSync(previousPath); } catch { /* ignore */ }
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await this.downloadFile(asset.downloadUrl, dest);
    this.manifest.files[itemKey] = {
      fileId: String(asset.fileId),
      sizeBytes: asset.sizeBytes ?? (fs.existsSync(dest) ? fs.statSync(dest).size : null),
      localName: path.basename(dest),
      originalName: asset.originalName,
    };
    this.writeManifest();
    this.lastSyncAt = Date.now();
    this.emit({
      lastAction: `Pushed ${asset.originalName || cueLabel}`,
      message: `Downloaded ${asset.originalName || cueLabel}`,
      error: '',
    });
    return { ok: true, path: dest, asset };
  }

  async followLoadedCue(loadedItemId, loadedCue = null, livePath = null, slideshowActive = false) {
    const cueLabel = loadedCue?.cueLabel || (loadedItemId != null ? `Cue ${loadedItemId}` : '');
    const timerState = loadedCue?.timerState || null;
    if (this.manualHold || this.closedByOperator) {
      const runningOther =
        loadedItemId != null &&
        timerState === 'running' &&
        Number(loadedItemId) !== Number(this.currentItemId);
      if (!runningOther) {
        this.emit({
          loadedCueLabel: cueLabel,
          message: this.closedByOperator
            ? 'PowerPoint closed · cue follow paused'
            : `Manual deck · ${this.status.deckName || 'open'}`,
          lastAction: this.closedByOperator ? 'Cue follow paused' : 'Manual deck',
        });
        return;
      }
      this.manualHold = false;
      this.closedByOperator = false;
    }
    if (loadedItemId == null) {
      this.emit({ loadedCueLabel: '', message: 'No cue loaded' });
      return;
    }
    let asset = preferredAssetForItem(this.assets, loadedItemId);
    if (asset && !this.isLiveOpenItem(loadedItemId)) {
      this.readManifest();
      const local = this.manifest.files[String(loadedItemId)] || {};
      if (
        !local.fileId ||
        shouldReplaceLocalFile(
          { ...local, path: this.localPathFor(asset, cueLabel) },
          { fileId: asset.fileId, sizeBytes: asset.sizeBytes }
        )
      ) {
        try {
          await this.syncOne(loadedItemId, asset.fileId);
          asset = preferredAssetForItem(this.assets, loadedItemId) || asset;
        } catch (err) {
          this.lastError = err.message || 'Could not download the newer deck';
        }
      }
    }
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
      void this.captureAndUploadPreviews(this.currentPath);
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
        void this.captureAndUploadPreviews(this.currentPath);
        this.emit({
          loadedCueLabel: cueLabel,
          message: `${cueLabel} · slideshow live`,
          lastAction: 'Slideshow live',
        });
        return;
      }
      await this.captureAndUploadPreviews(this.currentPath);
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
      await this.captureAndUploadPreviews(decision.path);
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
      await this.reportAndRefresh(true);
    }
  }

  async runCommand(command) {
    const action = String(command.action || '').toLowerCase();
    let result = null;
    if (action === 'resume') {
      this.manualHold = false;
      this.closedByOperator = false;
      this.lastCommandId = command.id;
      this.lastError = '';
      this.emit({ lastAction: 'Resumed cue follow', error: '' });
      await this.reportAndRefresh(true);
      return;
    }
    if (action === 'open') {
      await this.openManual(command);
      this.lastCommandId = command.id;
      return;
    }
    if (action === 'sync') {
      try {
        this.lastError = '';
        await this.syncOne(command.itemId, command.fileId);
        this.emit({ lastAction: 'Pushed new deck', error: '' });
      } catch (err) {
        this.lastError = err.message || 'Could not download the new deck';
        this.emit({ lastAction: 'Push failed', error: this.lastError });
      }
      this.lastCommandId = command.id;
      await this.reportAndRefresh(true);
      return;
    }
    if (action === 'next') result = await ppt.nextSlide();
    else if (action === 'prev') result = await ppt.prevSlide();
    else if (action === 'goto') result = await ppt.gotoSlide(command.slideIndex);
    else if (action === 'start') {
      this.closedByOperator = false;
      result = await ppt.startShow(this.currentPath);
    } else if (action === 'end') {
      result = await ppt.quitApp();
      this.closedByOperator = true;
      this.manualHold = false;
      this.currentPath = null;
      this.currentFileId = null;
      this.currentItemId = null;
      this.previewPath = '';
      this.lastStartedItemId = null;
    } else return;
    if (!result || result.ok === false) {
      this.lastError = result?.error || `Command ${action} failed`;
    } else {
      this.lastError = '';
      if (action === 'end') {
        this.emit({
          powerpoint: false,
          slideshowActive: false,
          deckName: '',
          slideCount: 0,
          currentIndex: null,
          livePath: '',
        });
      } else {
        this.applyLive(result);
      }
    }
    this.lastCommandId = command.id;
    this.emit({
      lastAction: action === 'end' ? 'Ended slideshow and closed PowerPoint' : `Web ${action}`,
      error: this.lastError,
    });
    await this.reportAndRefresh(true);
  }

  async openManual(command) {
    const itemId = Number(command.itemId);
    const fileId = command.fileId != null ? String(command.fileId) : '';
    let asset = Number.isFinite(itemId) ? preferredAssetForItem(this.assets, itemId) : null;
    if (!asset && fileId) {
      asset = (this.assets || []).find((row) => String(row.fileId) === fileId) || null;
    }
    if (!asset) {
      this.lastError = 'That deck is not in the sync folder yet. Click Sync decks first.';
      this.emit({ error: this.lastError, lastAction: 'Manual open failed' });
      return;
    }
    if (!this.isLiveOpenItem(asset.itemId)) {
      this.readManifest();
      const local = this.manifest.files[String(asset.itemId)] || {};
      if (
        !local.fileId ||
        shouldReplaceLocalFile(local, { fileId: asset.fileId, sizeBytes: asset.sizeBytes })
      ) {
        try {
          await this.syncOne(asset.itemId, asset.fileId);
          asset = preferredAssetForItem(this.assets, asset.itemId) || asset;
        } catch {
          /* try whatever is on disk */
        }
      }
    }
    const cueLabel = `Cue ${asset.itemId}`;
    let dest = this.localPathFor(asset, cueLabel);
    if (!dest || !fs.existsSync(dest)) {
      try {
        await this.syncOne(asset.itemId, asset.fileId);
      } catch {
        /* still try recorded path */
      }
      dest = this.localPathFor(asset, cueLabel);
    }
    if (!dest || !fs.existsSync(dest)) {
      this.lastError = `Synced file missing for ${asset.originalName || cueLabel}`;
      this.emit({ error: this.lastError, lastAction: 'Manual open failed' });
      return;
    }
    let result;
    try {
      result = await ppt.swapDeck(dest, this.currentPath);
    } catch (err) {
      this.lastError = err.message || 'Could not open deck';
      this.emit({ error: this.lastError, lastAction: 'Manual open failed' });
      return;
    }
    if (!result || result.ok === false) {
      this.lastError = result?.error || 'Could not open deck';
      this.emit({ error: this.lastError, lastAction: 'Manual open failed' });
      return;
    }
    await this.captureAndUploadPreviews(dest);
    if (!result.slideshowActive) {
      try {
        const started = await ppt.startShow(dest);
        if (started && started.ok !== false) {
          this.applyLive(started);
          result = { ...result, ...started, slideshowActive: !!started.slideshowActive };
        }
      } catch (err) {
        this.lastError = err.message || result.showWarning || '';
      }
    }
    this.manualHold = true;
    this.closedByOperator = false;
    this.currentPath = dest;
    this.currentFileId = asset.fileId || null;
    this.currentItemId = Number.isFinite(Number(asset.itemId)) ? Number(asset.itemId) : null;
    this.lastStartedItemId = this.currentItemId;
    this.lastError = result.showWarning || '';
    this.applyLive(result);
    this.emit({
      powerpoint: true,
      slideshowActive: !!result.slideshowActive,
      deckName: result.deckName || path.basename(dest),
      slideCount: result.slideCount || 0,
      currentIndex: Number(result.slideIndex) > 0 ? Number(result.slideIndex) : 1,
      lastAction: `Manual open & start · ${result.deckName || path.basename(dest)}`,
      error: this.lastError,
    });
    await this.reportAndRefresh(true);
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
      const stills = await ppt.captureStills({ width: 360, height: 202 });
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
      cacheFiles: this.cacheFilesList(),
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
    return this.syncCache({ replace: true });
  }
}

module.exports = { PlaybackController };
