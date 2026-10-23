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
function decidePlaybackAction({ hasPPT, cachedPath, currentPath, livePath, timerState }) {
  const openPath = livePath || currentPath || null;
  if (!hasPPT) {
    return { action: openPath ? 'close' : 'idle', path: null, closePath: openPath };
  }
  if (!cachedPath) {
    return { action: 'warn', path: null, closePath: null, warning: 'PPT checked but no synced deck for this cue' };
  }
  if (openPath && pathsEqual(cachedPath, openPath)) {
    if (timerState === 'running') {
      return { action: 'run', path: cachedPath, closePath: null };
    }
    return { action: 'keep', path: cachedPath, closePath: null };
  }
  return {
    action: 'swap',
    path: cachedPath,
    closePath: openPath,
    startShow: timerState === 'running',
  };
}

function pathsEqual(a, b) {
  if (!a || !b) return false;
  return String(a).replace(/\//g, '\\').toLowerCase() === String(b).replace(/\//g, '\\').toLowerCase();
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
};
