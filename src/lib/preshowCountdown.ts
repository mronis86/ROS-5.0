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

/** First non-indented cue overall, only if it is PreShow/End. */
export function findTopPreshowCue<T extends CueLike>(
  schedule: T[],
  indentedLookup?: IndentedCueLookup | null
): T | null {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  for (const item of schedule) {
    if (isIndentedScheduleItem(item, indentedLookup || {})) continue;
    if (item.programType === 'PreShow/End') return item;
    return null;
  }
  return null;
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

/** Event-scoped "confirm show day" arm for global Pre-Show auto-start. */
export type PreshowShowDayArmed = {
  confirmed: true;
  day: number;
  key: string;
  cueId: number | null;
  startHHMM: string;
  confirmedAt: string;
  confirmedBy?: string | null;
  confirmedByName?: string | null;
};

export function parsePreshowShowDay(raw: unknown): PreshowShowDayArmed | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.confirmed !== true) return null;
  const key = String(o.key || '').trim();
  if (!key) return null;
  return {
    confirmed: true,
    day: Number(o.day) || 1,
    key,
    cueId: o.cueId != null && Number.isFinite(Number(o.cueId)) ? Number(o.cueId) : null,
    startHHMM: String(o.startHHMM || ''),
    confirmedAt: String(o.confirmedAt || ''),
    confirmedBy: o.confirmedBy != null ? String(o.confirmedBy) : null,
    confirmedByName: o.confirmedByName != null ? String(o.confirmedByName) : null,
  };
}

export function isPreshowArmedForKey(
  armed: PreshowShowDayArmed | null | undefined,
  key: string
): boolean {
  return !!(armed?.confirmed && armed.key === key);
}
