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

export function dayStartFor(
  day: number,
  masterStartTime?: string,
  dayStartTimes?: Record<number | string, string>
): string {
  if (dayStartTimes) {
    const keyed = dayStartTimes[day] ?? dayStartTimes[String(day)];
    if (keyed) return String(keyed).trim();
  }
  return String(masterStartTime || '').trim();
}

/**
 * Per-cue wall-clock start from day/master start + prior same-day non-indented durations.
 * Returns a 12h locale string (e.g. "9:00 AM") or '' if unavailable.
 * `index` must be into the full ordered schedule (not a day-filtered slice).
 */
export function calculateScheduleStartTime(
  schedule: ScheduleStartItem[],
  index: number,
  masterStartTime?: string,
  dayStartTimes?: Record<number | string, string>,
  indentedLookup: IndentedCueLookup = {}
): string {
  const calcAt = (idx: number): string => {
    const current = schedule[idx];
    if (!current) return '';

    if (isIndentedScheduleItem(current, indentedLookup)) {
      const parentIndex = findParentScheduleIndex(schedule, idx, indentedLookup);
      if (parentIndex < 0) return '';
      return calcAt(parentIndex);
    }

    const itemDay = current.day || 1;
    const startTime = dayStartFor(itemDay, masterStartTime, dayStartTimes);
    if (!startTime) return '';

    let totalSeconds = 0;
    for (let i = 0; i < idx; i++) {
      const item = schedule[i];
      if ((item.day || 1) === itemDay && !isIndentedScheduleItem(item, indentedLookup)) {
        totalSeconds +=
          (Number(item.durationHours) || 0) * 3600 +
          (Number(item.durationMinutes) || 0) * 60 +
          (Number(item.durationSeconds) || 0);
      }
    }

    const [hours, minutes] = startTime.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return '';
    const totalStartSeconds = hours * 3600 + minutes * 60 + totalSeconds;
    const finalHours = Math.floor(totalStartSeconds / 3600) % 24;
    const finalMinutes = Math.floor((totalStartSeconds % 3600) / 60);
    const date = new Date();
    date.setHours(finalHours, finalMinutes, 0, 0);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return calcAt(index);
}
