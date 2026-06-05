export interface ScheduleStartItem {
  id: number;
  day?: number;
  isIndented?: boolean;
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
}

export type IndentedCueLookup =
  | Record<number, { parentId?: number } | unknown>
  | ((itemId: number) => boolean);

export function isIndentedScheduleItem(
  item: ScheduleStartItem | undefined,
  indentedLookup: IndentedCueLookup
): boolean {
  if (!item) return false;
  if (item.isIndented) return true;
  if (typeof indentedLookup === 'function') return indentedLookup(item.id);
  return Boolean(indentedLookup[item.id]);
}

/** Index of the parent (non-indented) row for an indented item, or -1. */
export function findParentScheduleIndex(
  schedule: ScheduleStartItem[],
  itemIndex: number,
  indentedLookup: IndentedCueLookup
): number {
  const item = schedule[itemIndex];
  if (!item) return -1;

  const isIndentedAt = (idx: number) =>
    isIndentedScheduleItem(schedule[idx], indentedLookup);

  if (!isIndentedAt(itemIndex)) return itemIndex;

  if (typeof indentedLookup !== 'function') {
    const entry = indentedLookup[item.id] as { parentId?: number } | undefined;
    if (entry?.parentId != null) {
      const explicitIdx = schedule.findIndex((s) => s.id === entry.parentId);
      if (explicitIdx >= 0) {
        let cursor = explicitIdx;
        while (cursor >= 0 && isIndentedAt(cursor)) {
          cursor = walkBackToParent(schedule, cursor, isIndentedAt);
        }
        return cursor;
      }
    }
  }

  return walkBackToParent(schedule, itemIndex, isIndentedAt);
}

function walkBackToParent(
  schedule: ScheduleStartItem[],
  fromIndex: number,
  isIndentedAt: (idx: number) => boolean
): number {
  for (let i = fromIndex - 1; i >= 0; i--) {
    if (!isIndentedAt(i)) return i;
  }
  return -1;
}
