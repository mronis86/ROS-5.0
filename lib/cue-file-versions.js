function assetNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function stampMs(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function preferredStamp(file) {
  return Math.max(stampMs(file?.preferredAt || file?.preferred_at), stampMs(file?.createdAt || file?.created_at));
}

function annotateCueFileVersions(files) {
  const list = Array.isArray(files) ? files.map((file) => ({ ...file })) : [];
  const groups = new Map();
  for (const file of list) {
    const key = `${Number(file.itemId ?? file.item_id)}::${assetNameKey(file.originalName || file.original_name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => stampMs(a.createdAt || a.created_at) - stampMs(b.createdAt || b.created_at));
    let current = group[0];
    for (const file of group) {
      if (preferredStamp(file) >= preferredStamp(current)) current = file;
    }
    group.forEach((file, index) => {
      file.version = index + 1;
      file.versionCount = group.length;
      file.isCurrent = file.id === current.id;
    });
  }
  return list;
}

function sortCueFilesForDisplay(files) {
  return [...(Array.isArray(files) ? files : [])].sort((a, b) => {
    const name = String(a.originalName || a.original_name || '').localeCompare(
      String(b.originalName || b.original_name || ''),
      undefined,
      { sensitivity: 'base' }
    );
    if (name) return name;
    return (Number(b.version) || 0) - (Number(a.version) || 0);
  });
}

module.exports = {
  assetNameKey,
  preferredStamp,
  annotateCueFileVersions,
  sortCueFilesForDisplay,
};
