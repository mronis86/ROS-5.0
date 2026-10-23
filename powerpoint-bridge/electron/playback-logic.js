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

/**
 * What Mode 2 should do when the loaded cue changes.
 * closePath is the currently open cached file, if any.
 */
function decidePlaybackAction({ hasPPT, cachedPath, currentPath }) {
  if (!hasPPT) {
    return { action: currentPath ? 'close' : 'idle', path: null, closePath: currentPath || null };
  }
  if (!cachedPath) {
    return { action: 'warn', path: null, closePath: null, warning: 'PPT checked but no cached deck for this cue' };
  }
  if (currentPath && pathsEqual(cachedPath, currentPath)) {
    return { action: 'keep', path: cachedPath, closePath: null };
  }
  return { action: 'swap', path: cachedPath, closePath: currentPath || null };
}

function pathsEqual(a, b) {
  if (!a || !b) return false;
  return String(a).replace(/\//g, '\\').toLowerCase() === String(b).replace(/\//g, '\\').toLowerCase();
}

module.exports = {
  isPptAssetName,
  safeFilePart,
  cacheFileName,
  preferredAssetForItem,
  decidePlaybackAction,
  pathsEqual,
};
