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
/** Built-in column show/hide — global per browser (all events). */
export const ROS_VISIBLE_COLUMNS_STORAGE_KEY = 'rosVisibleColumns';
/** Custom column show/hide keyed by column name — applies across events with same names. */
export const ROS_VISIBLE_CUSTOM_BY_NAME_STORAGE_KEY = 'rosVisibleCustomColumnsByName';

export type RosVisibleColumns = {
  start: boolean;
  programType: boolean;
  duration: boolean;
  segmentName: boolean;
  shotType: boolean;
  pptQA: boolean;
  recording: boolean;
  notes: boolean;
  assets: boolean;
  participants: boolean;
  speakers: boolean;
  public: boolean;
  timer: boolean;
  custom: boolean;
};

export const DEFAULT_ROS_VISIBLE_COLUMNS: RosVisibleColumns = {
  start: true,
  programType: true,
  duration: true,
  segmentName: true,
  shotType: true,
  pptQA: true,
  recording: true,
  notes: true,
  assets: true,
  participants: false,
  speakers: true,
  public: true,
  timer: true,
  custom: true,
};

export function loadRosVisibleColumns(): RosVisibleColumns {
  try {
    const raw = localStorage.getItem(ROS_VISIBLE_COLUMNS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ROS_VISIBLE_COLUMNS };
    const parsed = JSON.parse(raw) as Partial<RosVisibleColumns>;
    return { ...DEFAULT_ROS_VISIBLE_COLUMNS, ...parsed };
  } catch {
    return { ...DEFAULT_ROS_VISIBLE_COLUMNS };
  }
}

export function saveRosVisibleColumns(cols: RosVisibleColumns): void {
  try {
    localStorage.setItem(ROS_VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(cols));
  } catch {
    /* ignore */
  }
}

export function loadRosVisibleCustomByName(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(ROS_VISIBLE_CUSTOM_BY_NAME_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveRosVisibleCustomByName(byName: Record<string, boolean>): void {
  try {
    localStorage.setItem(ROS_VISIBLE_CUSTOM_BY_NAME_STORAGE_KEY, JSON.stringify(byName));
  } catch {
    /* ignore */
  }
}

/** Map custom column ids → visibility using saved name preferences. */
export function visibleCustomColumnsFromNames(
  columns: { id: string; name?: string }[],
  byName: Record<string, boolean> = loadRosVisibleCustomByName()
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const col of columns) {
    const name = (col.name || '').trim();
    if (name && Object.prototype.hasOwnProperty.call(byName, name)) {
      next[col.id] = Boolean(byName[name]);
    } else {
      next[col.id] = true;
    }
  }
  return next;
}

export function customColumnVisibilityToNames(
  columns: { id: string; name?: string }[],
  byId: Record<string, boolean>
): Record<string, boolean> {
  const byName = loadRosVisibleCustomByName();
  for (const col of columns) {
    const name = (col.name || '').trim();
    if (!name) continue;
    byName[name] = byId[col.id] !== false;
  }
  return byName;
}

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
