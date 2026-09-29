import { GUEST_VISIBLE_COLUMNS } from './guestRosHelpers';

export type GuestVisibleColumns = typeof GUEST_VISIBLE_COLUMNS;

/** Scrollable guest/creative columns ( # / CUE stay fixed; Start may pin beside CUE ). */
export const GUEST_SCROLL_COLUMNS = [
  'start',
  'programType',
  'duration',
  'segmentName',
  'shotType',
  'pptQA',
  'notes',
  'speakers',
] as const;

export type GuestScrollColumn = (typeof GUEST_SCROLL_COLUMNS)[number];

export const GUEST_COLUMN_LABELS: Record<GuestScrollColumn, string> = {
  start: 'Start',
  programType: 'Program',
  duration: 'Duration',
  segmentName: 'Segment',
  shotType: 'Shot',
  pptQA: 'PPT/Q&A',
  notes: 'Notes',
  speakers: 'Speakers',
};

export const GUEST_COLUMN_TOGGLE_OPTIONS: { key: GuestScrollColumn; label: string }[] =
  GUEST_SCROLL_COLUMNS.map((key) => ({ key, label: GUEST_COLUMN_LABELS[key] }));

export const GUEST_STICKY_START_STORAGE_KEY = 'guest-sticky-start';
export const CREATIVE_STICKY_START_STORAGE_KEY = 'creative-sticky-start';
export const GUEST_COLUMN_ORDER_STORAGE_KEY = 'guest-column-order';
export const CREATIVE_COLUMN_ORDER_STORAGE_KEY = 'creative-column-order';
export const GUEST_COLUMN_FILTER_STORAGE_KEY = 'guest-event-columns';

export function normalizeGuestColumnOrder(saved: string[] | null | undefined): GuestScrollColumn[] {
  const allowed = new Set<string>(GUEST_SCROLL_COLUMNS);
  const result: GuestScrollColumn[] = [];
  const seen = new Set<string>();
  for (const key of saved || []) {
    if (allowed.has(key) && !seen.has(key)) {
      result.push(key as GuestScrollColumn);
      seen.add(key);
    }
  }
  for (const key of GUEST_SCROLL_COLUMNS) {
    if (!seen.has(key)) result.push(key);
  }
  return result;
}

export function guestColumnFlexOrderMap(order: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  order.forEach((key, index) => {
    map[key] = index + 1;
  });
  return map;
}

export function moveGuestColumnInOrder(
  order: GuestScrollColumn[],
  fromIndex: number,
  toIndex: number
): GuestScrollColumn[] {
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

export function loadGuestVisibleColumns(storageKey: string): GuestVisibleColumns {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...GUEST_VISIBLE_COLUMNS };
    const parsed = JSON.parse(raw) as Partial<GuestVisibleColumns>;
    return { ...GUEST_VISIBLE_COLUMNS, ...parsed };
  } catch {
    return { ...GUEST_VISIBLE_COLUMNS };
  }
}

export function loadStickyStart(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

export function loadGuestColumnOrder(storageKey: string): GuestScrollColumn[] {
  try {
    const raw = localStorage.getItem(storageKey);
    return normalizeGuestColumnOrder(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeGuestColumnOrder(null);
  }
}

/** Sticky offsets: # = 3rem (48px), CUE = 10rem (160px). */
export const GUEST_STICKY_NUM_WIDTH_PX = 48;
export const GUEST_STICKY_CUE_WIDTH_PX = 160;
export const GUEST_STICKY_START_LEFT_PX = GUEST_STICKY_NUM_WIDTH_PX + GUEST_STICKY_CUE_WIDTH_PX;
