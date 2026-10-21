/**
 * In-Show live Start projection.
 *
 * Saved overtime only knows how long each cue ran, not the dead time between cues,
 * so the cascade drifts from the real clock. This anchors rows after the live cue to
 * what actually happened: the running cue's real start + its timer (or now, if it is
 * already over), or "now" for the next row when nothing is running.
 */
import { eventLocalSecondsOfDay } from './eventLocalClock';

const DAY_SECONDS = 86400;
/** Actual starts older than this are treated as stale (previous rehearsal / day). */
const MAX_ACTUAL_START_AGE_MS = 12 * 3600 * 1000;

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
  const { schedule, countsTowardStart, plannedStartSec, running, actualStarts, nowMs, timeZone } = args;
  const nowLocal = eventLocalSecondsOfDay(nowMs, timeZone);

  if (running && Number.isFinite(running.startedAtMs)) {
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

  let lastIdx = -1;
  let lastMs = -Infinity;
  for (const [rawId, ms] of Object.entries(actualStarts)) {
    if (!Number.isFinite(ms) || ms > nowMs || nowMs - ms > MAX_ACTUAL_START_AGE_MS) continue;
    const idx = schedule.findIndex((s) => s.id === Number(rawId));
    if (idx < 0 || !countsTowardStart(schedule[idx])) continue;
    if (ms > lastMs) {
      lastMs = ms;
      lastIdx = idx;
    }
  }
  if (lastIdx < 0) return null;

  const day = schedule[lastIdx].day || 1;
  let nextIdx = -1;
  for (let j = lastIdx + 1; j < schedule.length; j++) {
    if ((schedule[j].day || 1) !== day) break;
    if (countsTowardStart(schedule[j])) {
      nextIdx = j;
      break;
    }
  }
  if (nextIdx < 0) return null;
  const planned = plannedStartSec(nextIdx);
  if (planned == null) return null;
  return {
    anchorIndex: lastIdx,
    day,
    offsetMinutes: Math.round(wrapDaySeconds(nowLocal - planned) / 60),
  };
}
