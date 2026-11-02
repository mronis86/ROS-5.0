const fs = require('fs');
const path = require('path');
const ppt = require('./ppt-com');
const {
  fetchPlaybackManifest,
  fetchPlaybackStatus,
  fetchPlaybackAsset,
  reportPlaybackLive,
  fetchPlaybackPreviews,
  fetchPlaybackPreviewImage,
  uploadPlaybackPreviews,
  httpFetch,
} = require('./railway-client');
const {
  preferredAssetForItem,
  decidePlaybackAction,
  syncFileName,
  shouldReplaceLocalFile,
  deckPathsEqual,
  deckTitleKey,
  scoreLivePathMatch,
  PREVIEW_DIR_NAME,
  rawPreviewSlideId,
  itemDayNumber,
  cueMatchesSelectedDay,
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
    this.previewFileId = '';
    this.previewHoldPath = '';
    this.previewBusy = false;
    this.previewReady = false;
    this.liveTimer = null;
    this.manualHold = false;
    this.closedByOperator = false;
    this.cueFollowAuto = true;
    this.openMatch = '';
    this.openStale = false;
    this.stickyOpenUntil = 0;
    this.swapCooldownUntil = 0;
    this.swapInFlight = false;
    this.lastPreviewSync = { decks: 0, slides: 0, captured: 0, missing: 0 };
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
      selectedDay: this.selectedDay(),
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
      openMatch: this.openMatch,
      openStale: this.openStale,
      selectedDay: this.selectedDay(),
      previewDecks: this.lastPreviewSync?.decks || 0,
      previewSlides: this.lastPreviewSync?.slides || 0,
      previewCaptured: this.lastPreviewSync?.captured || 0,
      previewMissing: this.lastPreviewSync?.missing || 0,
    };
    this.onStatus(this.status);
  }

  markStickyOpen(ms = 5000) {
    this.stickyOpenUntil = Date.now() + Math.max(0, Number(ms) || 0);
  }

  selectedDay() {
    return Math.max(1, Math.floor(Number(this.config?.selectedDay) || 1));
  }

  numberOfDays() {
    return Math.max(1, Math.floor(Number(this.config?.numberOfDays) || 1));
  }

  dayForItem(itemId) {
    const asset = (this.assets || []).find((row) => Number(row.itemId) === Number(itemId));
    if (!asset || asset.day == null) return null;
    return itemDayNumber(asset);
  }

  cueLabelFor(assetOrItemId, fallbackCue) {
    if (fallbackCue && String(fallbackCue).trim()) return String(fallbackCue).trim();
    if (assetOrItemId && typeof assetOrItemId === 'object') {
      const labeled = String(assetOrItemId.cueLabel || '').trim();
      if (labeled) return labeled;
      const id = Number(assetOrItemId.itemId);
      if (Number.isFinite(id)) return `CUE ${id}`;
      return 'CUE';
    }
    const id = Number(assetOrItemId);
    const asset = Number.isFinite(id)
      ? (this.assets || []).find((row) => Number(row.itemId) === id)
      : null;
    const labeled = String(asset?.cueLabel || '').trim();
    if (labeled) return labeled;
    return Number.isFinite(id) ? `CUE ${id}` : 'CUE';
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

  normPath(value) {
    return String(value || '')
      .trim()
      .replace(/\//g, '\\')
      .replace(/\\+$/, '')
      .toLowerCase();
  }

  legacySyncNames(asset, cueLabel) {
    const names = new Set();
    const labeled = this.cueLabelFor(asset, cueLabel);
    names.add(syncFileName(asset, labeled));
    const itemId = Number(asset?.itemId);
    if (Number.isFinite(itemId)) {
      names.add(syncFileName(asset, `Cue ${itemId}`));
      names.add(syncFileName(asset, `CUE ${itemId}`));
    }
    if (asset?.originalName) names.add(path.basename(String(asset.originalName)));
    return [...names].filter(Boolean);
  }

  matchLivePath(livePath) {
    const live = this.normPath(livePath);
    if (!live) return null;
    this.readManifest();
    const liveBase = path.basename(livePath).toLowerCase();
    const liveTitle = deckTitleKey(livePath);
    const preferIds = [this.currentItemId, this.lastLoadedItemId]
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));

    const hits = [];
    for (const asset of this.assets || []) {
      if (!asset?.itemId) continue;
      const cueLabel = this.cueLabelFor(asset);
      const dest = this.localPathFor(asset, cueLabel);
      const recorded = this.manifest.files[String(asset.itemId)] || {};
      const alt = recorded.localName ? path.join(this.syncDir(), recorded.localName) : '';
      const legacyPaths = this.legacySyncNames(asset, cueLabel).map((name) =>
        path.join(this.syncDir(), name)
      );
      // Never include this.currentPath here — once a deck is open it equals livePath for
      // EVERY asset and the first row "wins", thrashing Open between cues.
      const candidates = [dest, alt, ...legacyPaths].filter(Boolean);
      let bestScore = 0;
      let bestCandidate = '';
      for (const row of candidates) {
        const score = scoreLivePathMatch(livePath, row);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = row;
        }
      }
      let nameScore = 0;
      if (bestScore < 90) {
        for (const name of [
          asset.originalName,
          recorded.localName,
          dest ? path.basename(dest) : '',
          ...this.legacySyncNames(asset, cueLabel),
        ].filter(Boolean)) {
          const base = path.basename(String(name)).toLowerCase();
          if (base === liveBase) nameScore = Math.max(nameScore, 85);
          else if (liveTitle && deckTitleKey(name) === liveTitle) {
            const liveCue = Number(asset.itemId);
            // Weak title-only hit; prefer assets whose item id matches the live cue prefix.
            const prefixCue = (() => {
              const m = liveBase.match(/^(?:cue|item)\s+(\d+)\s*-/i);
              return m ? Number(m[1]) : null;
            })();
            if (prefixCue != null && prefixCue === liveCue) nameScore = Math.max(nameScore, 75);
            else nameScore = Math.max(nameScore, 35);
          }
        }
      }
      const score = Math.max(bestScore, nameScore);
      if (score <= 0) continue;
      const preferredId = String(asset.fileId || '');
      const localId = String(recorded.fileId || preferredId || '');
      const resolved =
        (bestCandidate && fs.existsSync(bestCandidate) && bestCandidate) ||
        (dest && fs.existsSync(dest) && dest) ||
        (alt && fs.existsSync(alt) && alt) ||
        legacyPaths.find((row) => fs.existsSync(row)) ||
        null;
      hits.push({
        score,
        itemId: Number(asset.itemId),
        fileId: localId || preferredId || null,
        path: resolved,
        stale: !!(preferredId && localId && preferredId !== localId) || score < 90,
        originalName: asset.originalName || path.basename(livePath),
        preferredId,
      });
    }

    if (!hits.length) return null;
    hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aPref = preferIds.includes(a.itemId) ? 1 : 0;
      const bPref = preferIds.includes(b.itemId) ? 1 : 0;
      if (bPref !== aPref) return bPref - aPref;
      return a.itemId - b.itemId;
    });
    const top = hits[0];
    // Ambiguous weak title-only matches (shared original basename across cues) → do not guess.
    if (
      top.score < 70 &&
      hits.filter((h) => h.score === top.score).length > 1 &&
      !preferIds.includes(top.itemId)
    ) {
      return null;
    }
    return {
      itemId: top.itemId,
      fileId: top.fileId,
      path: top.path || this.currentPath || null,
      stale: !!top.stale,
      originalName: top.originalName,
    };
  }

  applyIdentifiedOpen(livePath) {
    const prevFile = String(this.currentFileId || '');
    const prevItem = this.currentItemId;
    if (!livePath) {
      // Mid-swap / PowerPoint briefly reports no path — keep last known open.
      this.openMatch = this.currentItemId != null ? this.openMatch || 'sync' : '';
      this.openStale = false;
      return false;
    }
    const info = this.matchLivePath(livePath);
    if (!info) {
      this.openMatch = 'unknown';
      this.openStale = false;
      // Do not flash Open now off while we just opened/swapped or PowerPoint is mid-rename.
      if (Date.now() < this.stickyOpenUntil || this.swapInFlight) return false;
      if (this.currentItemId != null && this.currentPath && deckPathsEqual(this.currentPath, livePath)) {
        return false;
      }
      // Ambiguous live identity — keep last known open rather than thrashing to null.
      if (this.currentItemId != null || this.lastLoadedItemId != null) return false;
      this.currentItemId = null;
      this.currentFileId = null;
      return prevFile !== '' || prevItem != null;
    }
    // Prefer sticky followed cue when matcher only got a weak title hit on another cue.
    if (
      this.lastLoadedItemId != null &&
      Number(info.itemId) !== Number(this.lastLoadedItemId) &&
      info.stale &&
      Date.now() < this.stickyOpenUntil
    ) {
      return false;
    }
    this.openMatch = info.stale ? 'stale' : 'sync';
    this.openStale = !!info.stale;
    this.currentItemId = info.itemId;
    this.currentFileId = info.fileId;
    if (info.path) this.currentPath = info.path;
    const changed =
      prevFile !== String(info.fileId || '') || Number(prevItem) !== Number(info.itemId);
    if (changed && info.fileId) {
      this.previewHoldPath = '';
      this.previewReady = false;
      void this.ensureFolderPreviews(info.fileId);
    }
    return changed;
  }

  previewDirFor(fileId) {
    return path.join(this.syncDir(), PREVIEW_DIR_NAME, String(fileId || 'unknown'));
  }

  readLocalPreviews(fileId) {
    if (!fileId) return null;
    try {
      const dir = this.previewDirFor(fileId);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      const slides = (Array.isArray(meta.slides) ? meta.slides : [])
        .map((slide) => {
          const jpg = path.join(dir, `${slide.pptSlideId}.jpg`);
          let imageBase64 = '';
          try {
            imageBase64 = fs.readFileSync(jpg).toString('base64');
          } catch {
            imageBase64 = '';
          }
          return {
            pptSlideId: String(slide.pptSlideId),
            slideIndex: Number(slide.slideIndex),
            title: slide.title || '',
            imageBase64,
            width: slide.width || 360,
            height: slide.height || 202,
          };
        })
        .filter((slide) => slide.imageBase64 && Number.isFinite(slide.slideIndex));
      if (!slides.length) return null;
      return { deckName: meta.deckName || '', slides };
    } catch {
      return null;
    }
  }

  clearLocalPreviews(fileId) {
    try {
      if (fileId) fs.rmSync(this.previewDirFor(fileId), { recursive: true, force: true });
      else fs.rmSync(path.join(this.syncDir(), PREVIEW_DIR_NAME), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
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
      const cueFollowAuto = playback?.session?.cueFollowAuto !== false;
      if (cueFollowAuto && !this.cueFollowAuto) {
        this.manualHold = false;
        this.closedByOperator = false;
      }
      this.cueFollowAuto = cueFollowAuto;
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
      const identityChanged = this.applyIdentifiedOpen(livePath);
      if (identityChanged) await this.reportAndRefresh(true);

      if (this.cueFollowAuto) {
        await this.followLoadedCue(loadedItemId, loadedCue, livePath, slideshowActive);
      } else {
        const cueLabel = loadedCue?.cueLabel || (loadedItemId != null ? `Cue ${loadedItemId}` : '');
        this.emit({
          loadedCueLabel: cueLabel,
          message: this.currentPath
            ? `Manual open · ${this.status.deckName || 'deck ready'}`
            : cueLabel
              ? `${cueLabel} loaded · open a deck from the launcher`
              : 'Manual open · waiting for Open & start',
          lastAction: this.currentPath ? this.status.lastAction || 'Manual open' : 'Manual open',
        });
      }

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
        existing.day = itemDayNumber(row.day != null ? row : existing);
        if (row.cueLabel) existing.cueLabel = String(row.cueLabel);
      } else {
        this.assets.push({
          itemId,
          fileId,
          originalName: row.originalName || 'deck.pptx',
          sizeBytes: row.sizeBytes != null ? Number(row.sizeBytes) : null,
          preferred: true,
          hasPPT: true,
          downloadUrl: null,
          day: itemDayNumber(row),
          cueLabel: row.cueLabel ? String(row.cueLabel) : `CUE ${itemId}`,
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
      const cueLabel = this.cueLabelFor(asset);
      const localName = syncFileName(asset, cueLabel);
      const dest = path.join(dir, localName);
      const previous = this.manifest.files[itemKey] || {};
      let previousPath = previous.localName ? path.join(dir, previous.localName) : dest;
      // Migrate Cue {itemId} → CUE {n} filenames so PowerPoint path identity stays stable.
      if (
        previousPath &&
        previousPath.toLowerCase() !== dest.toLowerCase() &&
        fs.existsSync(previousPath) &&
        !fs.existsSync(dest) &&
        !this.isLiveOpenItem(asset.itemId)
      ) {
        try {
          fs.renameSync(previousPath, dest);
          previousPath = dest;
        } catch {
          /* keep previousPath; download/replace can still use it */
        }
      } else if (
        previousPath &&
        previousPath.toLowerCase() !== dest.toLowerCase() &&
        this.isLiveOpenItem(asset.itemId) &&
        fs.existsSync(previousPath)
      ) {
        // Live open stays on the old path until follow swaps; keep reporting that path.
        keep.add(previousPath.toLowerCase());
      }
      keep.add(dest.toLowerCase());
      const onDiskPath = fs.existsSync(dest) ? dest : fs.existsSync(previousPath) ? previousPath : null;
      let state = onDiskPath ? 'ok' : 'missing';
      let detail = state === 'ok' ? 'Synced' : 'Not on disk';
      const needsReplace = shouldReplaceLocalFile(
        {
          fileId: previous.fileId,
          sizeBytes:
            previous.sizeBytes ?? (onDiskPath && fs.existsSync(onDiskPath) ? fs.statSync(onDiskPath).size : null),
          path: onDiskPath || previousPath,
        },
        { fileId: asset.fileId, sizeBytes: asset.sizeBytes }
      );
      const missing = !onDiskPath;
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
          sizeBytes:
            previous.sizeBytes ??
            (onDiskPath && fs.existsSync(onDiskPath) ? fs.statSync(onDiskPath).size : null),
          localName: this.isLiveOpenItem(asset.itemId)
            ? previous.localName || localName
            : localName,
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
          sizeBytes:
            previous.sizeBytes ??
            (onDiskPath && fs.existsSync(onDiskPath) ? fs.statSync(onDiskPath).size : null),
          localName: onDiskPath && onDiskPath.toLowerCase() === dest.toLowerCase()
            ? localName
            : previous.localName || localName,
          originalName: previous.originalName || asset.originalName,
        };
        if (previous.localName && previous.localName !== localName && fs.existsSync(dest)) {
          nextFiles[itemKey].localName = localName;
          detail = 'Renamed to ROS cue';
        }
      }
      const rowPath =
        nextFiles[itemKey].localName &&
        fs.existsSync(path.join(dir, nextFiles[itemKey].localName))
          ? path.join(dir, nextFiles[itemKey].localName)
          : dest;
      rows.push({
        fileId: nextFiles[itemKey].fileId,
        itemId: asset.itemId,
        cueLabel,
        name: asset.originalName,
        localName: nextFiles[itemKey].localName,
        hasPPT: !!asset.hasPPT,
        preferred: !!asset.preferred,
        day: itemDayNumber(asset),
        state,
        detail,
        path: rowPath,
      });
    }

    this.manifest.files = nextFiles;
    this.writeManifest();
    this.previewHoldPath = '';
    const previewStats = await this.syncSlideImages(nextFiles, { captureMissing: replace || !missingOnly });
    this.pruneOrphans(dir, keep);
    this.cacheRows = rows;
    this.lastSyncAt = Date.now();
    const deckOk = rows.filter((r) => r.state === 'ok' || r.state === 'replaced').length;
    const slideMsg =
      previewStats.slides > 0
        ? ` · ${previewStats.slides} slide images`
        : previewStats.missing > 0
          ? ` · ${previewStats.missing} deck(s) still need slide images`
          : '';
    const captureMsg =
      previewStats.captured > 0 ? ` · captured ${previewStats.captured}` : '';
    const message = `Synced ${deckOk}/${rows.length} decks${slideMsg}${captureMsg}`;
    this.emit({
      message,
      lastAction: 'Synced folder',
      syncFolder: this.config.syncFolder,
      syncComplete: true,
      previewDecks: previewStats.decks,
      previewSlides: previewStats.slides,
      previewCaptured: previewStats.captured,
      previewMissing: previewStats.missing,
    });
    return {
      rows,
      message,
      deckOk,
      deckTotal: rows.length,
      previewDecks: previewStats.decks,
      previewSlides: previewStats.slides,
      previewCaptured: previewStats.captured,
      previewMissing: previewStats.missing,
    };
  }

  pruneOrphans(root, keep) {
    if (!fs.existsSync(root)) return;
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          if (name === PREVIEW_DIR_NAME) continue;
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
      const pack = await this.syncCache({
        replace: false,
        onlyItemId: Number.isFinite(Number(itemId)) ? Number(itemId) : null,
      });
      return { rows: pack?.rows || [] };
    }
    this.mergePreferredFiles([asset]);
    const cueLabel = this.cueLabelFor(asset, asset.cueLabel) || this.cueLabelFor(asset.itemId || itemId);
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
    this.previewHoldPath = '';
    try {
      await this.downloadPreviewsForFile(String(asset.fileId));
    } catch {
      /* deck is on disk even if stills are missing */
    }
    this.lastSyncAt = Date.now();
    this.emit({
      lastAction: `Pushed ${asset.originalName || cueLabel}`,
      message: `Downloaded ${asset.originalName || cueLabel}`,
      error: '',
    });
    return { ok: true, path: dest, asset };
  }

  async followLoadedCue(loadedItemId, loadedCue = null, livePath = null, slideshowActive = false) {
    const cueLabel =
      loadedCue?.cueLabel ||
      this.cueLabelFor(loadedItemId) ||
      (loadedItemId != null ? `CUE ${loadedItemId}` : '');
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
    const rawDay = loadedCue?.day != null ? Number(loadedCue.day) : this.dayForItem(loadedItemId);
    const cueDay = Number.isFinite(rawDay) && rawDay >= 1 ? Math.floor(rawDay) : null;
    if (cueDay != null && !cueMatchesSelectedDay(cueDay, this.selectedDay(), this.numberOfDays())) {
      this.emit({
        loadedCueLabel: cueLabel,
        message: `${cueLabel} is Day ${cueDay} · this PC is Day ${this.selectedDay()}`,
        lastAction: 'Other day',
      });
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
      swapInFlight: this.swapInFlight || Date.now() < this.swapCooldownUntil,
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
      this.previewFileId = '';
      this.previewHoldPath = '';
      this.previewReady = false;
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
      // Open identity stays with applyIdentifiedOpen / pollLive — do NOT overwrite
      // currentItemId to the loaded cue (that fought live matching every ~220ms).
      this.lastLoadedItemId = loadedItemId;
      if (decision.uncertain) {
        this.emit({
          loadedCueLabel: cueLabel,
          message: `${cueLabel} · waiting for PowerPoint path`,
          lastAction: 'Path unsettled',
        });
        return;
      }
      this.markStickyOpen(4000);
      void this.ensureFolderPreviews(this.currentFileId || asset?.fileId);
      this.emit({
        loadedCueLabel: cueLabel,
        message: `${cueLabel} · matching deck ready`,
        lastAction: 'Matching deck',
      });
      return;
    }
    if (decision.action === 'run') {
      this.lastLoadedItemId = loadedItemId;
      this.markStickyOpen(4000);
      const runPath = decision.path || this.currentPath;
      if (this.lastStartedItemId === loadedItemId && this.status.slideshowActive) {
        void this.ensureFolderPreviews(this.currentFileId || asset?.fileId);
        this.emit({
          loadedCueLabel: cueLabel,
          message: `${cueLabel} · slideshow live`,
          lastAction: 'Slideshow live',
        });
        return;
      }
      if (runPath) this.currentPath = runPath;
      if (asset?.fileId) this.currentFileId = asset.fileId;
      // Sticky open for the transition; live matcher confirms after startShow.
      this.currentItemId = loadedItemId;
      void this.ensureFolderPreviews(this.currentFileId);
      try {
        const started = await ppt.startShow(this.currentPath);
        if (started && started.ok !== false) {
          this.applyLive(started);
          this.applyIdentifiedOpen(started.fullName || started.full_name || this.currentPath);
        }
        this.lastStartedItemId = loadedItemId;
        this.lastError = '';
        this.emit({
          loadedCueLabel: cueLabel,
          message: `${cueLabel} · started slideshow`,
          lastAction: 'Started slideshow',
          error: '',
        });
        await this.reportAndRefresh(true);
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
      if (this.swapInFlight || Date.now() < this.swapCooldownUntil) {
        this.emit({
          loadedCueLabel: cueLabel,
          message: `${cueLabel} · waiting for PowerPoint`,
          lastAction: 'Swap cooldown',
        });
        return;
      }
      this.swapInFlight = true;
      this.markStickyOpen(8000);
      let result;
      try {
        result = await ppt.swapDeck(decision.path, decision.closePath);
      } catch (err) {
        this.swapInFlight = false;
        this.swapCooldownUntil = Date.now() + 2500;
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
        this.swapInFlight = false;
        this.swapCooldownUntil = Date.now() + 2500;
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
      this.previewReady = false;
      void this.captureAndUploadPreviews(this.currentPath, { force: false });
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
      this.swapInFlight = false;
      this.swapCooldownUntil = Date.now() + 2500;
      this.markStickyOpen(6000);
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
    if (action === 'clear-previews') {
      const fileId = command.fileId != null ? String(command.fileId) : this.currentFileId;
      this.clearLocalPreviews(fileId || null);
      this.previewPath = '';
      this.previewFileId = '';
      this.previewHoldPath = this.currentPath || '';
      this.previewReady = false;
      this.lastCommandId = command.id;
      this.emit({ lastAction: 'Cleared slide images', error: '' });
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
      this.previewFileId = '';
      this.previewHoldPath = '';
      this.previewReady = false;
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
    const cueLabel = this.cueLabelFor(asset);
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
    this.manualHold = true;
    this.closedByOperator = false;
    this.currentPath = dest;
    this.currentFileId = asset.fileId || null;
    this.currentItemId = Number.isFinite(Number(asset.itemId)) ? Number(asset.itemId) : null;
    this.lastStartedItemId = this.currentItemId;
    this.previewReady = false;
    void this.ensureFolderPreviews(this.currentFileId);
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
    const livePath = live.fullName || live.full_name || this.status.livePath;
    this.emit({
      powerpoint: true,
      slideshowActive: !!live.slideshowActive,
      deckName: live.deckName || this.status.deckName,
      slideCount: live.slideCount || this.status.slideCount,
      livePath,
      currentIndex: Number.isFinite(Number(live.slideIndex)) && Number(live.slideIndex) > 0
        ? Number(live.slideIndex)
        : this.status.currentIndex,
      openMatch: this.openMatch,
      openStale: this.openStale,
      currentItemId: this.currentItemId,
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
      // Don't fight tick/follow mid-swap — that was publishing Open thrash.
      if (this.busy || this.swapInFlight) {
        this.scheduleLive(400);
        return;
      }
      const live = await ppt.getLive();
      if (live && live.ok !== false) this.applyLive(live);
      const beforeItem = this.currentItemId;
      const beforeFile = this.currentFileId;
      this.applyIdentifiedOpen(this.status.livePath);
      const key = this.liveFingerprint();
      const identityChanged =
        Number(beforeItem) !== Number(this.currentItemId) ||
        String(beforeFile || '') !== String(this.currentFileId || '');
      const changed = key !== this.lastLiveKey;
      if (forceReport || identityChanged || changed || Date.now() - this.lastReportAt > 2000) {
        await this.reportAndRefresh(false);
        this.lastLiveKey = this.liveFingerprint();
      }
    } catch {
      /* next poll */
    }
    this.scheduleLive(this.status.slideshowActive ? 220 : 500);
  }

  async downloadPreviewCatalog(nextFiles) {
    let files = {};
    try {
      const pack = await fetchPlaybackPreviews(
        this.config.apiBaseUrl,
        this.config.apiToken,
        this.config.eventId
      );
      files = pack?.files && typeof pack.files === 'object' ? pack.files : {};
    } catch {
      files = {};
    }
    const seen = new Set();
    let decks = 0;
    let slides = 0;
    for (const row of Object.values(nextFiles || {})) {
      const fileId = String(row?.fileId || '').trim();
      if (!fileId || seen.has(fileId)) continue;
      seen.add(fileId);
      try {
        const local = await this.writePreviewsFromRemote(fileId, files[fileId] || []);
        if (local?.slides?.length) {
          decks += 1;
          slides += local.slides.length;
        }
      } catch {
        /* keep the deck even if stills fail */
      }
    }
    return { decks, slides, files };
  }

  countLocalPreviewSlides(fileId) {
    const local = this.readLocalPreviews(fileId);
    return local?.slides?.length || 0;
  }

  writeLocalPreviews(fileId, stills) {
    if (!fileId || !stills?.slides?.length) return null;
    const dir = this.previewDirFor(fileId);
    fs.mkdirSync(dir, { recursive: true });
    const slides = [];
    for (const slide of stills.slides) {
      const pptSlideId = String(slide.pptSlideId || '').trim();
      if (!pptSlideId || !slide.imageBase64) continue;
      fs.writeFileSync(path.join(dir, `${pptSlideId}.jpg`), Buffer.from(slide.imageBase64, 'base64'));
      slides.push({
        pptSlideId,
        slideIndex: Number(slide.slideIndex),
        title: slide.title || '',
        width: slide.width || 360,
        height: slide.height || 202,
      });
    }
    if (!slides.length) return null;
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(
        {
          fileId,
          deckName: stills.deckName || '',
          capturedAt: new Date().toISOString(),
          source: 'capture',
          slides,
        },
        null,
        2
      ),
      'utf8'
    );
    return this.readLocalPreviews(fileId);
  }

  async captureAndUploadPreviews(filePath, opts = {}) {
    if (!filePath || this.previewBusy) return null;
    if (this.previewHoldPath && this.previewHoldPath === filePath && !opts.force) return null;
    const fileId = String(opts.fileId || this.currentFileId || '').trim();
    if (!fileId) return null;
    if (!opts.force) {
      const existing = this.readLocalPreviews(fileId);
      if (existing?.slides?.length) {
        this.previewPath = filePath;
        this.previewFileId = fileId;
        this.previewReady = true;
        return existing;
      }
    }
    this.previewBusy = true;
    try {
      const stills = await ppt.captureStills({ width: 360, height: 202 });
      if (!stills || stills.ok === false || !Array.isArray(stills.slides) || !stills.slides.length) {
        return null;
      }
      const local = this.writeLocalPreviews(fileId, stills);
      try {
        await uploadPlaybackPreviews(this.config.apiBaseUrl, this.config.apiToken, this.config.eventId, {
          fileId,
          deckName: stills.deckName || this.status.deckName,
          slides: stills.slides,
        });
      } catch {
        /* local stills still usable */
      }
      this.previewPath = filePath;
      this.previewFileId = fileId;
      this.previewHoldPath = '';
      this.previewReady = !!(local?.slides?.length);
      this.emit({
        slideCount: stills.slideCount || stills.slides.length,
        lastAction: `Captured ${stills.slides.length} slide images`,
      });
      return local;
    } catch (err) {
      this.lastError = err.message || 'Could not capture slide images';
      this.emit({ error: this.lastError });
      return null;
    } finally {
      this.previewBusy = false;
    }
  }

  async capturePreviewsFromSyncedFile(filePath, fileId) {
    const wanted = String(fileId || '').trim();
    if (!filePath || !wanted || !fs.existsSync(filePath)) return null;
    const priorPath = this.currentPath;
    const priorFile = this.currentFileId;
    const priorItem = this.currentItemId;
    const restoreNeeded = !priorPath || !deckPathsEqual(priorPath, filePath);
    try {
      if (restoreNeeded) {
        await ppt.openDeck(filePath, null);
      }
      const local = await this.captureAndUploadPreviews(filePath, { force: true, fileId: wanted });
      return local;
    } finally {
      if (restoreNeeded && priorPath && fs.existsSync(priorPath)) {
        try {
          await ppt.openDeck(priorPath, filePath);
          this.currentPath = priorPath;
          this.currentFileId = priorFile;
          this.currentItemId = priorItem;
        } catch {
          /* leave capture deck open if restore fails */
        }
      } else if (restoreNeeded && !priorPath) {
        try {
          await ppt.closeDeck(filePath);
        } catch {
          /* ignore */
        }
      }
    }
  }

  async syncSlideImages(nextFiles, opts = {}) {
    const captureMissing = opts.captureMissing !== false;
    this.emit({ message: 'Downloading slide images…', lastAction: 'Sync images' });
    const downloaded = await this.downloadPreviewCatalog(nextFiles);
    let decks = downloaded.decks || 0;
    let slides = downloaded.slides || 0;
    let captured = 0;
    let missing = 0;
    const seen = new Set();
    for (const row of Object.values(nextFiles || {})) {
      const fileId = String(row?.fileId || '').trim();
      if (!fileId || seen.has(fileId)) continue;
      seen.add(fileId);
      const localCount = this.countLocalPreviewSlides(fileId);
      if (localCount > 0) {
        if (!downloaded.decks || localCount) {
          /* already counted if from API; recount unique below */
        }
        continue;
      }
      if (!captureMissing) {
        missing += 1;
        continue;
      }
      const localName = row.localName || '';
      const filePath = localName ? path.join(this.syncDir(), localName) : '';
      if (!filePath || !fs.existsSync(filePath)) {
        missing += 1;
        continue;
      }
      this.emit({
        message: `Capturing slide images · ${path.basename(filePath)}`,
        lastAction: 'Capture images',
      });
      try {
        const local = await this.capturePreviewsFromSyncedFile(filePath, fileId);
        if (local?.slides?.length) {
          captured += 1;
          decks += 1;
          slides += local.slides.length;
        } else {
          missing += 1;
        }
      } catch {
        missing += 1;
      }
    }
    // Recount from disk so toast is accurate even when API already had some.
    decks = 0;
    slides = 0;
    missing = 0;
    const counted = new Set();
    for (const row of Object.values(nextFiles || {})) {
      const fileId = String(row?.fileId || '').trim();
      if (!fileId || counted.has(fileId)) continue;
      counted.add(fileId);
      const n = this.countLocalPreviewSlides(fileId);
      if (n > 0) {
        decks += 1;
        slides += n;
      } else {
        missing += 1;
      }
    }
    this.lastPreviewSync = { decks, slides, captured, missing };
    return this.lastPreviewSync;
  }

  async downloadPreviewsForFile(fileId) {
    const wanted = String(fileId || '').trim();
    if (!wanted) return null;
    const pack = await fetchPlaybackPreviews(
      this.config.apiBaseUrl,
      this.config.apiToken,
      this.config.eventId,
      wanted
    );
    return this.writePreviewsFromRemote(wanted, pack?.slides || []);
  }

  async writePreviewsFromRemote(fileId, slides) {
    const wanted = String(fileId || '').trim();
    const incoming = Array.isArray(slides) ? slides : [];
    if (!wanted || !incoming.length) return null;
    const dir = this.previewDirFor(wanted);
    fs.mkdirSync(dir, { recursive: true });
    const metaSlides = [];
    for (const slide of incoming) {
      if (!slide?.hasImage && !slide?.imageUrl) continue;
      const rawId = rawPreviewSlideId(wanted, slide.pptSlideId);
      if (!rawId) continue;
      const jpg = path.join(dir, `${rawId}.jpg`);
      const remoteMs = slide.updatedAt ? new Date(slide.updatedAt).getTime() : 0;
      let skip = false;
      try {
        if (fs.existsSync(jpg)) {
          const localMs = fs.statSync(jpg).mtimeMs;
          if (!remoteMs || localMs >= remoteMs) skip = true;
        }
      } catch {
        skip = false;
      }
      if (!skip) {
        try {
          const buf = await fetchPlaybackPreviewImage(
            this.config.apiBaseUrl,
            this.config.apiToken,
            this.config.eventId,
            slide.pptSlideId
          );
          if (buf?.length) fs.writeFileSync(jpg, buf);
        } catch {
          /* keep any older local jpeg */
        }
      }
      if (!fs.existsSync(jpg)) continue;
      metaSlides.push({
        pptSlideId: rawId,
        slideIndex: Number(slide.slideIndex),
        title: slide.title || '',
        width: slide.width || 360,
        height: slide.height || 202,
      });
    }
    if (!metaSlides.length) return null;
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(
        {
          fileId: wanted,
          deckName: '',
          capturedAt: new Date().toISOString(),
          source: 'api',
          slides: metaSlides,
        },
        null,
        2
      ),
      'utf8'
    );
    return this.readLocalPreviews(wanted);
  }

  async ensureFolderPreviews(fileId, opts = {}) {
    const wanted = String(fileId || this.currentFileId || '').trim();
    if (!wanted || this.previewBusy) return;
    if (this.previewHoldPath && !opts.force) return;
    if (!opts.force && this.previewReady && this.previewFileId === wanted) return;
    this.previewBusy = true;
    let local = null;
    try {
      local = this.readLocalPreviews(wanted);
      if (!local?.slides?.length) {
        try {
          local = await this.downloadPreviewsForFile(wanted);
        } catch {
          local = null;
        }
      }
      this.previewFileId = wanted;
      this.previewPath = this.currentPath || '';
      this.previewReady = !!(local?.slides?.length);
      if (local?.slides?.length) {
        this.emit({
          slideCount: local.slides.length,
          lastAction: `Loaded ${local.slides.length} synced slide images`,
        });
        return;
      }
    } finally {
      this.previewBusy = false;
    }
    if (this.currentPath && fs.existsSync(this.currentPath)) {
      await this.captureAndUploadPreviews(this.currentPath, { force: !!opts.force, fileId: wanted });
    }
  }

  async reportAndRefresh(_unusedLive) {
    const sticky =
      (Date.now() < this.stickyOpenUntil || this.swapInFlight) &&
      this.currentItemId == null &&
      this.lastLoadedItemId != null;
    await reportPlaybackLive(this.config.apiBaseUrl, this.config.apiToken, this.config.eventId, {
      helperMode: 'playback',
      helperInstanceId: String(this.config.helperInstanceId || '').trim(),
      deckName: this.status.deckName || '',
      slideCount: this.status.slideCount || 0,
      slideshowActive: !!this.status.slideshowActive,
      currentIndex: this.status.currentIndex,
      currentItemId: sticky ? this.lastLoadedItemId : this.currentItemId,
      currentFileId: this.currentFileId,
      cacheOk: this.cacheRows.filter((r) => r.state === 'ok' || r.state === 'replaced').length,
      cacheTotal: this.cacheRows.length,
      cacheFiles: this.cacheFilesList(),
      lastCommand: this.status.lastAction || '',
      lastCommandId: this.lastCommandId,
      lastError: this.lastError || '',
      livePath: this.status.livePath || '',
      openMatch: this.openMatch || '',
      openStale: !!this.openStale,
      selectedDay: this.selectedDay(),
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
