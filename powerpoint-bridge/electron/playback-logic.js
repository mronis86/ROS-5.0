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
}) {
  const openPath = livePath || currentPath || null;
  if (!hasPPT) {
    return { action: openPath ? 'close' : 'idle', path: null, closePath: openPath };
  }
  if (!cachedPath) {
    return { action: 'warn', path: null, closePath: null, warning: 'PPT checked but no synced deck for this cue' };
  }
  if (openPath && pathsEqual(cachedPath, openPath)) {
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
  PREVIEW_DIR_NAME,
  rawPreviewSlideId,
  itemDayNumber,
  cueMatchesSelectedDay,
  calendarShowDay,
};
