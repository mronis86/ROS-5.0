import { formatScheduleClock } from './scheduleClockFormat';
import { parseClockToSeconds, resolveTimedMarkerDisplayTime } from './timedMarker';

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
    const startTime = dayStartFor(itemDay, masterStartTime, dayStartTimes);
    if (!startTime) return '';

    let totalSeconds = 0;
    for (let i = 0; i < idx; i++) {
      const item = schedule[i];
      if ((item.day || 1) === itemDay && itemCountsTowardStartTime(item, indentedLookup)) {
        totalSeconds +=
          (Number(item.durationHours) || 0) * 3600 +
          (Number(item.durationMinutes) || 0) * 60 +
          (Number(item.durationSeconds) || 0);
      }
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
  return rowDay === startCueDay;
}

export type StartTimeOvertimeOpts = {
  masterStartTime?: string;
  dayStartTimes?: Record<number | string, string>;
  indentedLookup?: IndentedCueLookup;
  overtimeMinutes?: Record<number, number>;
  startCueId?: number | null;
  showStartOvertime?: number;
  /** Live projection minutes applied to rows after the anchor. */
  liveOffsetMinutes?: number | null;
  liveAnchorIndex?: number | null;
  liveAnchorDay?: number | null;
};

/**
 * Planned Start plus saved overtime (and optional live-cue projection).
 * Same cascade the ROS Start column uses for est / was / OT badges.
 */
export function calculateScheduleStartTimeWithOvertime(
  schedule: ScheduleStartItem[],
  index: number,
  opts: StartTimeOvertimeOpts = {}
): string {
  const indentedLookup = opts.indentedLookup ?? {};
  const overtimeMinutes = opts.overtimeMinutes ?? {};
  const startCueId = opts.startCueId ?? null;
  const showStartOvertime = opts.showStartOvertime ?? 0;

  const calcAt = (idx: number): string => {
    const current = schedule[idx];
    if (!current) return '';

    if (current.isTimedMarker) {
      const parentIndex = findParentScheduleIndex(schedule, idx, indentedLookup);
      const parentStart =
        parentIndex >= 0 && current.markerTimeMode !== 'absolute'
          ? calcAt(parentIndex)
          : parentIndex >= 0
            ? calculateScheduleStartTime(
                schedule,
                parentIndex,
                opts.masterStartTime,
                opts.dayStartTimes,
                indentedLookup
              )
            : '';
      return resolveTimedMarkerDisplayTime(current, parentStart);
    }

    if (isIndentedScheduleItem(current, indentedLookup)) {
      const parentIndex = findParentScheduleIndex(schedule, idx, indentedLookup);
      if (parentIndex < 0) return '';
      return calcAt(parentIndex);
    }

    const baseStartTime = calculateScheduleStartTime(
      schedule,
      idx,
      opts.masterStartTime,
      opts.dayStartTimes,
      indentedLookup
    );
    if (!baseStartTime) return '';

    const liveOffset = opts.liveOffsetMinutes;
    if (
      liveOffset != null &&
      opts.liveAnchorIndex != null &&
      idx > opts.liveAnchorIndex &&
      (current.day || 1) === (opts.liveAnchorDay || 1)
    ) {
      const baseSec = parseClockToSeconds(baseStartTime);
      if (baseSec == null) return baseStartTime;
      return formatScheduleClock(baseSec + liveOffset * 60);
    }

    let totalOvertimeMinutes = 0;
    const startCueIndex = startCueId != null ? schedule.findIndex((s) => s.id === startCueId) : -1;
    const startCountingFrom = startCueIndex !== -1 ? startCueIndex : 0;
    for (let i = startCountingFrom; i < idx; i++) {
      const item = schedule[i];
      if ((item.day || 1) === (current.day || 1) && itemCountsTowardStartTime(item, indentedLookup)) {
        totalOvertimeMinutes += overtimeMinutes[item.id] || 0;
      }
    }
    if (
      shouldApplyShowStartOvertime({
        showStartOvertime,
        startCueId,
        startCueIndex,
        rowIndex: idx,
        schedule,
        rowDay: current.day || 1,
      })
    ) {
      totalOvertimeMinutes += showStartOvertime;
    }
    if (totalOvertimeMinutes === 0) return baseStartTime;
    const baseSec = parseClockToSeconds(baseStartTime);
    if (baseSec == null) return baseStartTime;
    return formatScheduleClock(baseSec + totalOvertimeMinutes * 60);
  };

  return calcAt(index);
}

/** Saved + live overtime minutes that apply to a row (for the Start OT badge). */
export function cumulativeOvertimeMinutesForIndex(
  schedule: ScheduleStartItem[],
  index: number,
  opts: StartTimeOvertimeOpts = {}
): number {
  const current = schedule[index];
  if (!current || isIndentedScheduleItem(current, opts.indentedLookup ?? {})) return 0;
  if (
    opts.liveOffsetMinutes != null &&
    opts.liveAnchorIndex != null &&
    index > opts.liveAnchorIndex &&
    (current.day || 1) === (opts.liveAnchorDay || 1)
  ) {
    return opts.liveOffsetMinutes;
  }
  const indentedLookup = opts.indentedLookup ?? {};
  const overtimeMinutes = opts.overtimeMinutes ?? {};
  const startCueId = opts.startCueId ?? null;
  const startCueIndex = startCueId != null ? schedule.findIndex((s) => s.id === startCueId) : -1;
  const startCountingFrom = startCueIndex !== -1 ? startCueIndex : 0;
  let total = 0;
  for (let i = startCountingFrom; i < index; i++) {
    const item = schedule[i];
    if ((item.day || 1) === (current.day || 1) && itemCountsTowardStartTime(item, indentedLookup)) {
      total += overtimeMinutes[item.id] || 0;
    }
  }
  if (
    shouldApplyShowStartOvertime({
      showStartOvertime: opts.showStartOvertime || 0,
      startCueId,
      startCueIndex,
      rowIndex: index,
      schedule,
      rowDay: current.day || 1,
    })
  ) {
    total += opts.showStartOvertime || 0;
  }
  return total;
}

