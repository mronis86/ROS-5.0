/** Built-in columns that live in the horizontal scroll area (# / CUE / pinned Start stay fixed). */
export const BUILTIN_SCROLL_COLUMNS = [
  'start',
  'programType',
  'duration',
  'segmentName',
  'shotType',
  'pptQA',
  'recording',
  'notes',
  'assets',
  'speakers',
  'public',
  'timer',
] as const;

export type BuiltinScrollColumn = (typeof BUILTIN_SCROLL_COLUMNS)[number];

export const BUILTIN_COLUMN_LABELS: Record<BuiltinScrollColumn, string> = {
  start: 'Start Time',
  programType: 'Program Type',
  duration: 'Duration',
  segmentName: 'Segment Name',
  shotType: 'Shot Type',
  pptQA: 'PPT/Q&A',
  recording: 'Recording',
  notes: 'Notes',
  assets: 'Assets',
  speakers: 'Speakers',
  public: 'Public',
  timer: 'Counter',
};

export const ROS_COLUMN_ORDER_STORAGE_KEY = 'rosColumnOrder';

export function customColumnOrderKey(id: string): string {
  return `custom:${id}`;
}

export function parseCustomColumnOrderKey(key: string): string | null {
  return key.startsWith('custom:') ? key.slice('custom:'.length) : null;
}

/** Merge saved order with current built-ins + custom columns; drop unknowns. */
export function normalizeColumnOrder(
  saved: string[] | null | undefined,
  customIds: string[] = []
): string[] {
  const customKeys = customIds.map(customColumnOrderKey);
  const allowed = new Set<string>([...BUILTIN_SCROLL_COLUMNS, ...customKeys]);
  const result: string[] = [];
  const seen = new Set<string>();

  for (const key of saved || []) {
    if (allowed.has(key) && !seen.has(key)) {
      result.push(key);
      seen.add(key);
    }
  }

  for (const key of BUILTIN_SCROLL_COLUMNS) {
    if (!seen.has(key)) {
      result.push(key);
      seen.add(key);
    }
  }

  for (const key of customKeys) {
    if (!seen.has(key)) {
      result.push(key);
      seen.add(key);
    }
  }

  return result;
}

export function columnFlexOrderMap(order: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  order.forEach((key, index) => {
    map[key] = index + 1;
  });
  return map;
}

export function moveColumnInOrder(order: string[], fromIndex: number, toIndex: number): string[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= order.length ||
    toIndex >= order.length ||
    fromIndex === toIndex
  ) {
    return order;
  }
  const next = [...order];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}
