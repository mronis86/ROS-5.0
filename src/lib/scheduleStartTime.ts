import { formatScheduleClock } from './scheduleClockFormat';
import {
  breakStartTimeOf,
  isShowBreakProgramType,
  lastShowBreakIndexBefore,
  parseBreakStartTimeToSeconds,
  sameShowSession,
} from './showBreak';
import { resolveTimedMarkerDisplayTime } from './timedMarker';

export interface ScheduleStartItem {
  id: number;
  day?: number;
  programType?: string;
  isIndented?: boolean;
  /** Timed marker under a parent: start time only, no duration. */
  isTimedMarker?: boolean;
  markerTimeMode?: 'absolute' | 'offset';
  markerOffsetSeconds?: number;
  markerAbsoluteSeconds?: number;
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
  /** HH:MM restart clock on a Show Break row. */
  breakStartTime?: string | null;
}

export type IndentedCueLookup =
  | Record<number, { parentId?: number } | unknown>
  | ((itemId: number) => boolean);

export function isIndentedScheduleItem(
  item: ScheduleStartItem | undefined,
  indentedLookup: IndentedCueLookup
): boolean {
  if (!item) return false;
  // Timed markers are always grouped under a parent (do not advance the timeline).
  if (item.isTimedMarker) return true;
  if (item.isIndented) return true;
  if (typeof indentedLookup === 'function') return indentedLookup(item.id);
  return Boolean(indentedLookup[item.id]);
}

export function isKilledScheduleItem(item?: { programType?: string } | null): boolean {
  return String(item?.programType || '').trim().toUpperCase() === 'KILLED';
}

/** Non-indented live cues only — Killed rows do not consume Start-time duration. */
export function itemCountsTowardStartTime(
  item: ScheduleStartItem | undefined,
  indentedLookup: IndentedCueLookup
): boolean {
  if (!item) return false;
  if (isKilledScheduleItem(item)) return false;
  if (isShowBreakProgramType(item.programType)) return false;
  if (isIndentedScheduleItem(item, indentedLookup)) return false;
  return true;
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

    if (current.isTimedMarker) {
      const parentIndex = findParentScheduleIndex(schedule, idx, indentedLookup);
      // Absolute markers don't need parent start; offset markers do.
      const parentStart = parentIndex >= 0 ? calcAt(parentIndex) : '';
      return resolveTimedMarkerDisplayTime(current, parentStart);
    }

    if (isIndentedScheduleItem(current, indentedLookup)) {
      const parentIndex = findParentScheduleIndex(schedule, idx, indentedLookup);
      if (parentIndex < 0) return '';
      return calcAt(parentIndex);
    }

    const itemDay = current.day || 1;
    if (isShowBreakProgramType(current.programType)) {
      const breakSec = parseBreakStartTimeToSeconds(breakStartTimeOf(current));
      if (breakSec == null) return '';
      return formatScheduleClock(breakSec, 'hm');
    }

    const breakIdx = lastShowBreakIndexBefore(schedule, idx, itemDay);
    const breakSec =
      breakIdx >= 0 ? parseBreakStartTimeToSeconds(breakStartTimeOf(schedule[breakIdx])) : null;
    if (breakIdx >= 0 && breakSec == null) return '';
    const startTime = breakSec != null ? '' : dayStartFor(itemDay, masterStartTime, dayStartTimes);
    if (breakSec == null && !startTime) return '';

    let totalSeconds = 0;
    const sumFrom = breakIdx >= 0 ? breakIdx + 1 : 0;
    for (let i = sumFrom; i < idx; i++) {
      const item = schedule[i];
      if ((item.day || 1) === itemDay && itemCountsTowardStartTime(item, indentedLookup)) {
        totalSeconds +=
          (Number(item.durationHours) || 0) * 3600 +
          (Number(item.durationMinutes) || 0) * 60 +
          (Number(item.durationSeconds) || 0);
      }
    }

    if (breakSec != null) {
      return formatScheduleClock(breakSec + totalSeconds, 'hm');
    }

    const parts = startTime.split(':').map(Number);
    const hours = parts[0];
    const minutes = parts[1];
    const startSecs = Number.isFinite(parts[2]) ? parts[2] : 0;
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return '';
    const totalStartSeconds = hours * 3600 + minutes * 60 + startSecs + totalSeconds;
    return formatScheduleClock(totalStartSeconds, 'hm');
  };

  return calcAt(index);
}

/**
 * ★ show-start offset applies only on the START cue's day.
 * Without this, Day 1's late/early minutes bleed onto Day 2+ (those rows
 * always have a higher schedule index than Day 1's ★).
 */
export function shouldApplyShowStartOvertime(opts: {
  showStartOvertime: number;
  startCueId: number | null | undefined;
  startCueIndex: number;
  rowIndex: number;
  schedule: ScheduleStartItem[];
  rowDay: number;
}): boolean {
  const {
    showStartOvertime,
    startCueId,
    startCueIndex,
    rowIndex,
    schedule,
    rowDay,
  } = opts;
  if (
    !showStartOvertime ||
    startCueId == null ||
    startCueIndex < 0 ||
    rowIndex < startCueIndex
  ) {
    return false;
  }
  const startCueDay = schedule[startCueIndex]?.day || 1;
  if (rowDay !== startCueDay) return false;
  return sameShowSession(schedule, startCueIndex, rowIndex);
}

