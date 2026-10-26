const VERSION_SUFFIX = /(?:[\s_-]+v|[\s]*\([vV])(\d+)\)?$/i;

function splitAssetName(name) {
  const raw = String(name || 'file').trim() || 'file';
  const dot = raw.lastIndexOf('.');
  const hasExt = dot > 0 && dot < raw.length - 1 && !raw.slice(dot + 1).includes(' ');
  const stem = hasExt ? raw.slice(0, dot) : raw;
  const ext = hasExt ? raw.slice(dot) : '';
  const stripped = stem.replace(VERSION_SUFFIX, '').trim() || stem;
  return { base: stripped, ext, stem };
}

function assetNameKey(name) {
  const { base, ext } = splitAssetName(name);
  return `${base}${ext}`.toLowerCase();
}

function versionedFileName(originalName, version, versionCount) {
  const { base, ext } = splitAssetName(originalName);
  const n = Number(version) || 1;
  if (!(Number(versionCount) > 1)) return `${base}${ext}`;
  return `${base}_V${n}${ext}`;
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
    const family = splitAssetName(group[0].originalName || group[0].original_name || 'file');
    group.forEach((file, index) => {
      const originalName = file.originalName || file.original_name || family.base;
      const parts = splitAssetName(originalName);
      file.version = index + 1;
      file.versionCount = group.length;
      file.isCurrent = file.id === current.id;
      file.versionedName = versionedFileName(
        `${family.base}${parts.ext || family.ext}`,
        file.version,
        file.versionCount
      );
    });
  }
  return list;
}

function sortCueFilesForDisplay(files) {
  return [...(Array.isArray(files) ? files : [])].sort((a, b) => {
    const name = assetNameKey(a.originalName || a.original_name).localeCompare(
      assetNameKey(b.originalName || b.original_name),
      undefined,
      { sensitivity: 'base' }
    );
    if (name) return name;
    return (Number(b.version) || 0) - (Number(a.version) || 0);
  });
}

module.exports = {
  assetNameKey,
  splitAssetName,
  versionedFileName,
  preferredStamp,
  annotateCueFileVersions,
  sortCueFilesForDisplay,
};
