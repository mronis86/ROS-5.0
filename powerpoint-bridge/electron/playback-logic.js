function isPptAssetName(name) {
  return /\.pptx?$/i.test(String(name || '').trim());
}

function safeFilePart(name) {
  return String(name || 'deck.pptx')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'deck.pptx';
}

function cacheFileName(fileId, originalName) {
  const ext = /\.pptx$/i.test(originalName || '') ? '.pptx' : /\.ppt$/i.test(originalName || '') ? '.ppt' : '.pptx';
  const base = safeFilePart(originalName).replace(/\.pptx?$/i, '');
  return `${String(fileId || 'file')}-${base}${ext}`;
}

function preferredAssetForItem(assets, itemId) {
  const id = Number(itemId);
  if (!Number.isFinite(id)) return null;
  const matches = (Array.isArray(assets) ? assets : []).filter(
    (a) => Number(a.itemId) === id && isPptAssetName(a.originalName)
  );
  const preferred = matches.find((a) => a.preferred);
  return preferred || matches[0] || null;
}

function syncFileName(asset, cueLabel) {
  const originalName = asset?.originalName || 'deck.pptx';
  const ext = /\.pptx$/i.test(originalName) ? '.pptx' : /\.ppt$/i.test(originalName) ? '.ppt' : '.pptx';
  const cue = safeFilePart(cueLabel || `Cue ${asset?.itemId || 'item'}`);
  const base = safeFilePart(originalName).replace(/\.pptx?$/i, '');
  return `${cue} - ${base}${ext}`;
}

function shouldReplaceLocalFile(local, remote) {
  if (!local) return true;
  if (remote?.fileId && local.fileId && String(local.fileId) !== String(remote.fileId)) return true;
  if (
    remote?.sizeBytes != null &&
    Number(remote.sizeBytes) > 0 &&
    Number(local.sizeBytes) !== Number(remote.sizeBytes)
  ) {
    return true;
  }
  if (local.path && !fsExistsSafe(local.path)) return true;
  return false;
}

function fsExistsSafe(filePath) {
  if (!filePath) return false;
  try {
    return require('fs').existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * What Mode 2 should do when the ROS cue changes.
 * livePath is whatever PowerPoint actually has open (may not be our sync file).
 */
function decidePlaybackAction({
  hasPPT,
  cachedPath,
  currentPath,
  livePath,
  timerState,
  slideshowActive,
  swapInFlight = false,
}) {
  // Match "already open" from PowerPoint's live path only — never from currentPath
  // (that was poisoned to the loaded cue and caused Open/Loaded thrash).
  const openPath = livePath || null;
  const closePath = livePath || currentPath || null;
  if (!hasPPT) {
    return { action: closePath ? 'close' : 'idle', path: null, closePath };
  }
  if (!cachedPath) {
    return { action: 'warn', path: null, closePath: null, warning: 'PPT checked but no synced deck for this cue' };
  }
  if (!openPath) {
    // Mid-swap COM often blanks FullName for a moment — wait, don't open twice.
    if (swapInFlight) {
      return { action: 'keep', path: cachedPath, closePath: null, uncertain: true };
    }
    // Nothing open yet (normal load) → open the cue's synced deck.
    return {
      action: 'swap',
      path: cachedPath,
      closePath: currentPath || null,
      startShow: true,
    };
  }
  if (deckPathsEqual(cachedPath, openPath)) {
    if (!slideshowActive) {
      return { action: 'run', path: cachedPath, closePath: null };
    }
    return { action: 'keep', path: cachedPath, closePath: null };
  }
  return {
    action: 'swap',
    path: cachedPath,
    closePath: openPath,
    startShow: true,
  };
}

function pathsEqual(a, b) {
  if (!a || !b) return false;
  return String(a).replace(/\//g, '\\').toLowerCase() === String(b).replace(/\//g, '\\').toLowerCase();
}

/** Strip cue/item prefixes so renames like "Cue 4 - Deck" ↔ "CUE 4 - Deck" still match. */
function deckTitleKey(filePath) {
  const base = String(filePath || '')
    .replace(/\//g, '\\')
    .split('\\')
    .pop()
    .toLowerCase()
    .replace(/\.pptx?$/i, '');
  return base
    .replace(/^cue\s+\d+\s*-\s*/i, '')
    .replace(/^item\s+\d+\s*-\s*/i, '')
    .trim();
}

/** Cue number from sync names like "CUE 7 - Map.pptx"; null if none. */
function deckCueNumber(filePath) {
  const base = String(filePath || '')
    .replace(/\//g, '\\')
    .split('\\')
    .pop()
    .replace(/\.pptx?$/i, '');
  const m = base.match(/^(?:cue|item)\s+(\d+)\s*-/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Same deck file, including cue-label renames for the SAME cue number
 * ("Cue 4 - Deck" ↔ "CUE 4 - Deck"). Shared titles with different/missing cue
 * numbers are NOT equal — that false keep was thrashing Open vs Loaded.
 */
function deckPathsEqual(a, b) {
  if (pathsEqual(a, b)) return true;
  if (!a || !b) return false;
  const ba = String(a).replace(/\//g, '\\').split('\\').pop().toLowerCase();
  const bb = String(b).replace(/\//g, '\\').split('\\').pop().toLowerCase();
  if (ba && ba === bb) return true;
  const ta = deckTitleKey(a);
  const tb = deckTitleKey(b);
  if (!ta || !tb || ta !== tb) return false;
  const ca = deckCueNumber(a);
  const cb = deckCueNumber(b);
  // Title-only equality only when both names carry the same cue number.
  return ca != null && cb != null && ca === cb;
}

/**
 * Rank how well a candidate sync path matches the live PowerPoint path.
 * Higher is better. 0 = no match.
 */
function scoreLivePathMatch(livePath, candidatePath) {
  if (!livePath || !candidatePath) return 0;
  if (pathsEqual(livePath, candidatePath)) return 100;
  const liveBase = String(livePath).replace(/\//g, '\\').split('\\').pop().toLowerCase();
  const candBase = String(candidatePath).replace(/\//g, '\\').split('\\').pop().toLowerCase();
  if (liveBase && liveBase === candBase) return 90;
  if (!deckPathsEqual(livePath, candidatePath)) return 0;
  const liveCue = deckCueNumber(livePath);
  const candCue = deckCueNumber(candidatePath);
  if (liveCue != null && candCue != null && liveCue === candCue) return 70;
  // Title-only (no conflicting cue numbers) — weak; ambiguous across cues.
  return 40;
}

function itemDayNumber(item) {
  const n = Number(item?.day ?? item?.dayNumber ?? item?.day_number);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function cueMatchesSelectedDay(cueDay, selectedDay, numberOfDays) {
  const days = Math.max(1, Math.floor(Number(numberOfDays) || 1));
  if (days <= 1) return true;
  const want = Math.max(1, Math.floor(Number(selectedDay) || 1));
  const got = Math.max(1, Math.floor(Number(cueDay) || 1));
  return got === want;
}

function calendarShowDay(eventDate, numberOfDays, now = new Date()) {
  const raw = String(eventDate || '').trim();
  const parts = raw.split('-').map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const start = new Date(parts[0], parts[1] - 1, parts[2]).getTime();
  const days = Math.max(1, Math.floor(Number(numberOfDays) || 1));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayIndex = Math.round((today - start) / 86400000);
  if (dayIndex < 0 || dayIndex >= days) return null;
  return dayIndex + 1;
}

const PREVIEW_DIR_NAME = '.previews';

function rawPreviewSlideId(fileId, pptSlideId) {
  const id = String(pptSlideId || '').trim();
  const fid = String(fileId || '').trim();
  if (!id) return '';
  if (fid) {
    const prefix = `${fid}::`;
    if (id.startsWith(prefix)) return id.slice(prefix.length);
  }
  return id;
}

module.exports = {
  isPptAssetName,
  safeFilePart,
  cacheFileName,
  syncFileName,
  shouldReplaceLocalFile,
  preferredAssetForItem,
  decidePlaybackAction,
  pathsEqual,
  deckPathsEqual,
  deckTitleKey,
  deckCueNumber,
  scoreLivePathMatch,
  PREVIEW_DIR_NAME,
  rawPreviewSlideId,
  itemDayNumber,
  cueMatchesSelectedDay,
  calendarShowDay,
};
