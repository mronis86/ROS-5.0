import type { EventCueFile } from '../services/api-client';

const VERSION_SUFFIX = /(?:[\s_-]+v|[\s]*\([vV])(\d+)\)?$/i;

function splitAssetName(name: string) {
  const raw = String(name || 'file').trim() || 'file';
  const dot = raw.lastIndexOf('.');
  const hasExt = dot > 0 && dot < raw.length - 1 && !raw.slice(dot + 1).includes(' ');
  const stem = hasExt ? raw.slice(0, dot) : raw;
  const ext = hasExt ? raw.slice(dot) : '';
  const stripped = stem.replace(VERSION_SUFFIX, '').trim() || stem;
  return { base: stripped, ext };
}

export function versionedFileName(originalName: string, version?: number | null, versionCount?: number | null) {
  const { base, ext } = splitAssetName(originalName);
  const n = Number(version) || 1;
  if (!(Number(versionCount) > 1)) return `${base}${ext}`;
  return `${base}_V${n}${ext}`;
}

export function cueFileDisplayName(file: Pick<EventCueFile, 'originalName' | 'versionedName' | 'version' | 'versionCount'>) {
  const computed = versionedFileName(file.originalName || file.versionedName || 'file', file.version, file.versionCount);
  if (Number(file.versionCount) > 1) return computed;
  return file.versionedName || file.originalName || computed;
}
