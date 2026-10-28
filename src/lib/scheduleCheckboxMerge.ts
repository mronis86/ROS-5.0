/** Per-field stamps so a stale row save cannot undo a newer checkbox (REC / PPT / Q&A / Public / Mitti / AV). */

export const SCHEDULE_CHECKBOX_FIELDS = [
  'hasPPT',
  'hasQA',
  'needsRecording',
  'recordingSource',
  'mittiWatch',
  'avWatch',
  'isPublic',
] as const;

export type ScheduleCheckboxField = (typeof SCHEDULE_CHECKBOX_FIELDS)[number];

function stampNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function checkboxStampMap(item: Record<string, any> | null | undefined): Record<string, number> {
  const raw = item?.checkboxStamps && typeof item.checkboxStamps === 'object' ? item.checkboxStamps : {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const n = stampNumber(value);
    if (n) out[key] = n;
  }
  const recAt = stampNumber(item?.recordingUpdatedAt ?? item?.recording_updated_at);
  if (recAt > (out.needsRecording || 0)) {
    out.needsRecording = recAt;
    out.recordingSource = Math.max(out.recordingSource || 0, recAt);
  }
  return out;
}

export function stampScheduleCheckboxes<T extends Record<string, any>>(
  item: T,
  fields: readonly string[],
  at = Date.now()
): T {
  const checkboxStamps = { ...checkboxStampMap(item) };
  for (const field of fields) checkboxStamps[field] = at;
  const next: Record<string, any> = { ...item, checkboxStamps };
  if (fields.includes('needsRecording')) next.recordingUpdatedAt = at;
  return next as T;
}

export function mergeNewerCheckboxFields<T extends Record<string, any>>(
  incoming: T,
  existing: T | null | undefined
): T {
  if (!incoming) return existing as T;
  if (!existing) return incoming;
  const inStamps = checkboxStampMap(incoming);
  const exStamps = checkboxStampMap(existing);
  const next: Record<string, any> = { ...incoming };
  const checkboxStamps = { ...exStamps, ...inStamps };
  for (const field of SCHEDULE_CHECKBOX_FIELDS) {
    const inAt = inStamps[field] || 0;
    const exAt = exStamps[field] || 0;
    if (exAt > inAt) {
      next[field] = existing[field];
      checkboxStamps[field] = exAt;
    }
  }
  next.checkboxStamps = checkboxStamps;
  if (checkboxStamps.needsRecording) next.recordingUpdatedAt = checkboxStamps.needsRecording;
  return next as T;
}

export function applyNewerCheckboxFields(incomingItems: any[], existingItems: any[] | null | undefined): any[] {
  if (!Array.isArray(incomingItems)) return incomingItems;
  if (!Array.isArray(existingItems) || existingItems.length === 0) return incomingItems;
  const byId = new Map(existingItems.map((item) => [Number(item.id), item]));
  return incomingItems.map((item) => mergeNewerCheckboxFields(item, byId.get(Number(item.id))));
}

function checkboxFlag(value: unknown): string {
  return value === true || value === 'true' || value === 1 || value === '1' ? '1' : '';
}

export function checkboxFieldsSignature(item: Record<string, any> | null | undefined): string {
  if (!item) return '';
  const stamps = checkboxStampMap(item);
  return SCHEDULE_CHECKBOX_FIELDS.map(
    (field) => `${field}:${checkboxFlag(item[field])}:${stamps[field] || 0}`
  ).join('|');
}

/** Rows whose PPT/Q&A/REC/Public flags differ from the last synced snapshot. */
export function idsWithCheckboxChanges(localItems: any[], syncedItems: any[] | null | undefined): number[] {
  const syncedById = new Map((syncedItems || []).map((item) => [Number(item.id), item]));
  const ids: number[] = [];
  for (const item of localItems || []) {
    const id = Number(item.id);
    if (!Number.isFinite(id)) continue;
    const synced = syncedById.get(id);
    if (!synced || checkboxFieldsSignature(item) !== checkboxFieldsSignature(synced)) {
      ids.push(id);
    }
  }
  return ids;
}

export function overlayExclusiveWatch(
  items: any[],
  itemId: number,
  field: 'mittiWatch' | 'avWatch',
  enabled: boolean,
  at = Date.now()
): any[] {
  return (items || []).map((row) => {
    const id = Number(row.id);
    const nextValue = enabled ? id === Number(itemId) : id === Number(itemId) ? false : !!row[field];
    if (!!row[field] === nextValue) return row;
    return stampScheduleCheckboxes({ ...row, [field]: nextValue }, [field], at);
  });
}
