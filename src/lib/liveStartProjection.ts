/**
 * In-Show live Start projection.
 *
 * Only while a cue is running. Gaps (after Clear/Reset, or between morning and
 * evening) stay on planned Start. "Now vs next cue" was sliding the rest of the
 * day early and looked like overtime coming back.
 */
import { eventLocalSecondsOfDay } from './eventLocalClock';

const DAY_SECONDS = 86400;

/** Settings key: false after Reset/Clear until the next cue is loaded or started. */
export function parseLiveStartProjectionArmed(value: unknown): boolean {
  return value !== false;
}

export type LiveStartAnchor = {
  /** Schedule index of the cue the projection is anchored to; rows after it shift. */
  anchorIndex: number;
  day: number;
  /** Whole minutes added to every planned (no-overtime) start after the anchor. */
  offsetMinutes: number;
};

type ProjectionRow = {
  id: number;
  day?: number;
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
};

export type RunningCueForProjection = {
  itemId: number;
  startedAtMs: number;
  durationSec: number;
};

/** Wrap a wall-clock difference into [-12h, +12h) so midnight crossings stay small. */
function wrapDaySeconds(diff: number): number {
  let d = diff % DAY_SECONDS;
  if (d >= DAY_SECONDS / 2) d -= DAY_SECONDS;
  if (d < -DAY_SECONDS / 2) d += DAY_SECONDS;
  return d;
}

function rowDurationSec(row: ProjectionRow): number {
  return (row.durationHours || 0) * 3600 + (row.durationMinutes || 0) * 60 + (row.durationSeconds || 0);
}

export function computeLiveStartAnchor(args: {
  schedule: ProjectionRow[];
  /** Same rule as the planned cascade (not KILLED, not indented). */
  countsTowardStart: (row: ProjectionRow) => boolean;
  /** Planned start (no overtime) for a row, seconds since midnight; null when unknown. */
  plannedStartSec: (index: number) => number | null;
  running: RunningCueForProjection | null;
  actualStarts: Record<number, number>;
  nowMs: number;
  timeZone: string;
}): LiveStartAnchor | null {
  const { schedule, countsTowardStart, plannedStartSec, running, nowMs, timeZone } = args;
  const nowLocal = eventLocalSecondsOfDay(nowMs, timeZone);

  if (!running || !Number.isFinite(running.startedAtMs)) return null;
  const idx = schedule.findIndex((s) => s.id === running.itemId);
  if (idx < 0 || !countsTowardStart(schedule[idx])) return null;
  const planned = plannedStartSec(idx);
  if (planned == null) return null;
  const startLocal = eventLocalSecondsOfDay(running.startedAtMs, timeZone);
  const elapsed = Math.max(0, wrapDaySeconds(nowLocal - startLocal));
  const projectedEnd = startLocal + Math.max(running.durationSec, elapsed);
  const offsetSec = wrapDaySeconds(projectedEnd - (planned + rowDurationSec(schedule[idx])));
  return {
    anchorIndex: idx,
    day: schedule[idx].day || 1,
    offsetMinutes: Math.round(offsetSec / 60),
  };
}
