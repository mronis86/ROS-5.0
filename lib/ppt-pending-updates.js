function normalizeCacheFiles(raw) {
  if (raw == null) return null;
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.files) ? raw.files : [];
  const out = [];
  const seen = new Set();
  for (const row of list) {
    const itemId = Number(row?.itemId ?? row?.item_id);
    const fileId =
      row?.fileId != null
        ? String(row.fileId)
        : row?.file_id != null
          ? String(row.file_id)
          : '';
    if (!Number.isFinite(itemId) || !fileId || seen.has(itemId)) continue;
    seen.add(itemId);
    out.push({ itemId, fileId });
  }
  return out;
}

function listPendingDeckUpdates({ preferred = [], cacheFiles = null, skipItemIds = [], cueLabels = {} } = {}) {
  if (!Array.isArray(cacheFiles)) return [];
  const cacheByItem = new Map(
    cacheFiles
      .map((row) => [Number(row.itemId), String(row.fileId || '')])
      .filter(([itemId, fileId]) => Number.isFinite(itemId) && fileId)
  );
  const skip = new Set(
    (Array.isArray(skipItemIds) ? skipItemIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id))
  );
  const pending = [];
  for (const asset of Array.isArray(preferred) ? preferred : []) {
    const itemId = Number(asset?.itemId);
    const fileId = asset?.fileId != null ? String(asset.fileId) : '';
    if (!Number.isFinite(itemId) || !fileId || skip.has(itemId)) continue;
    const localFileId = cacheByItem.get(itemId) || null;
    if (localFileId && localFileId === fileId) continue;
    if (!localFileId && cacheFiles.length === 0) continue;
    pending.push({
      itemId,
      fileId,
      originalName: String(asset.originalName || asset.original_name || 'deck.pptx'),
      sizeBytes: asset.sizeBytes != null ? Number(asset.sizeBytes) : asset.size_bytes != null ? Number(asset.size_bytes) : null,
      cueLabel: String(cueLabels[itemId] || asset.cueLabel || `CUE ${itemId}`),
      localFileId,
    });
  }
  return pending;
}

module.exports = {
  normalizeCacheFiles,
  listPendingDeckUpdates,
};
