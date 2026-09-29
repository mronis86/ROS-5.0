import { isIndentedScheduleItem, type IndentedCueLookup } from './scheduleStartTime';
import { normalizeCalloutTimeToHHMM } from './eventLocalClock';

export const PRESHOW_COUNTDOWN_MESSAGE = 'Pre Show Countdown';
export const PRESHOW_MESSAGE_TYPE = 'preshow';
export const PRESHOW_WARN_MINUTES_BEFORE = 5;

type CueLike = {
  id: number;
  programType?: string;
  day?: number;
  isIndented?: boolean;
};

function eventDayNumberForDate(
  eventDate?: string | null,
  numberOfDays = 1,
  now: Date = new Date()
): number | null {
  if (!eventDate) return null;
  const start = new Date(`${String(eventDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const days = Math.max(1, Math.floor(Number(numberOfDays) || 1));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayIndex = Math.floor((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (dayIndex < 0 || dayIndex >= days) return null;
  return dayIndex + 1;
}

/**
 * First non-indented cue for a day (or the whole schedule), only if it is PreShow/End.
 * Pass `day` for multi-day events so Day 2+ PreShow gets warn/confirm/auto-start.
 */
export function findTopPreshowCue<T extends CueLike>(
  schedule: T[],
  indentedLookup?: IndentedCueLookup | null,
  day?: number | null
): T | null {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  const wantDay =
    day != null && Number.isFinite(Number(day)) ? Math.floor(Number(day)) : null;
  for (const item of schedule) {
    if (wantDay != null && (item.day || 1) !== wantDay) continue;
    if (isIndentedScheduleItem(item, indentedLookup || {})) continue;
    if (item.programType === 'PreShow/End') return item;
    return null;
  }
  return null;
}

/** Calendar show day when in range; otherwise `fallbackDay` (e.g. selectedDay). */
export function resolvePreshowWorkingDay(
  eventDate: string | null | undefined,
  numberOfDays: number | null | undefined,
  fallbackDay = 1
): number {
  const cal = eventDayNumberForDate(eventDate, numberOfDays || 1);
  if (cal != null) return cal;
  return Math.max(1, Math.floor(Number(fallbackDay) || 1));
}

/**
 * Wall-clock HH:MM for the top PreShow cue (day master start, or locked override).
 * Prefer this over locale "1:12 PM" strings for reliable UTC conversion.
 */
export function resolvePreshowStartHHMM(opts: {
  cue: CueLike;
  lockedStartTimes?: Record<number, string>;
  dayStartTimes?: Record<number, string>;
  masterStartTime?: string;
}): string | null {
  const locked = opts.lockedStartTimes?.[opts.cue.id];
  if (locked) {
    const n = normalizeCalloutTimeToHHMM(locked);
    if (n) return n;
  }
  const day = opts.cue.day || 1;
  const raw = (opts.dayStartTimes?.[day] || opts.masterStartTime || '').trim();
  if (!raw) return null;
  return normalizeCalloutTimeToHHMM(raw);
}

export function isPreshowTimerMessage(msg: {
  enabled?: boolean;
  message?: string;
  message_type?: string;
} | null | undefined): boolean {
  if (!msg?.enabled) return false;
  if (msg.message_type === PRESHOW_MESSAGE_TYPE) return true;
  return String(msg.message || '').trim() === PRESHOW_COUNTDOWN_MESSAGE;
}
