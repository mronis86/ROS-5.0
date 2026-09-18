/**
 * Event-local wall clock helpers for VO/MUSIC alerts and similar show-time UI.
 * Prefer server-synced Date.now()+clockOffset, then interpret times in the event timezone
 * as absolute UTC moments — never browser getHours()/getMinutes() alone.
 */

export function getSyncedNow(clockOffsetMs = 0): Date {
  return new Date(Date.now() + (Number.isFinite(clockOffsetMs) ? clockOffsetMs : 0));
}

/** First non-empty IANA timezone from candidates (calendar → settings → fallback). */
export function resolveShowTimezone(
  ...candidates: Array<string | null | undefined>
): string {
  for (const raw of candidates) {
    const tz = typeof raw === 'string' ? raw.trim() : '';
    if (!tz) continue;
    try {
      // Validate IANA id — throws on garbage like "Eastern Time"
      Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
      return tz;
    } catch {
      continue;
    }
  }
  return 'America/New_York';
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  let hour = get('hour');
  if (hour === 24) hour = 0;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: Number.isFinite(hour) ? hour : 0,
    minute: get('minute') || 0,
    second: get('second') || 0,
  };
}

/** "HH:MM" (24h) for `date` in `timeZone`. Never silently uses the browser zone when a tz was requested. */
export function getEventLocalHHMM(date: Date, timeZone?: string | null): string {
  const tz = resolveShowTimezone(typeof timeZone === 'string' ? timeZone.trim() : null);
  try {
    const z = getZonedParts(date, tz);
    return `${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`;
  } catch {
    try {
      const z = getZonedParts(date, 'America/New_York');
      return `${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`;
    } catch {
      const hh = String(date.getUTCHours()).padStart(2, '0');
      const mm = String(date.getUTCMinutes()).padStart(2, '0');
      return `${hh}:${mm}`;
    }
  }
}

/** Minutes since midnight from "HH:MM" or "HH:MM:SS" (24h). */
export function hhmmToMinutes(hhmm: string): number | null {
  const m = String(hhmm || '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes since midnight from schedule labels like "1:30 PM" or "13:30". */
export function wallClockLabelToMinutes(label: string): number | null {
  const raw = String(label || '')
    .trim()
    // Browsers often insert narrow no-break spaces before AM/PM
    .replace(/[\u00a0\u202f\u2007\u2009]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return null;
  const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const min = Number(ampm[2]);
    const period = ampm[3].toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
    return h * 60 + min;
  }
  return hhmmToMinutes(raw);
}

/** Normalize any callout time string to padded 24h "HH:MM". */
export function normalizeCalloutTimeToHHMM(time: string): string | null {
  const mins = wallClockLabelToMinutes(time);
  if (mins == null) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Convert an event-venue wall-clock "HH:MM" on the same calendar day as `ref`
 * (in that timezone) into an absolute UTC epoch ms.
 * Everyone with the same wall clock + timezone gets the same UTC instant.
 */
export function eventWallClockToUtcMs(
  calloutTime: string,
  timeZone: string | null | undefined,
  ref: Date = new Date()
): number | null {
  const mins = wallClockLabelToMinutes(calloutTime);
  if (mins == null) return null;
  const wantH = Math.floor(mins / 60);
  const wantM = mins % 60;
  const tz = resolveShowTimezone(timeZone);
  const day = getZonedParts(ref, tz);

  // Iterate: guess UTC, read back in event TZ, correct until it matches desired wall time.
  let guess = Date.UTC(day.year, day.month - 1, day.day, wantH, wantM, 0);
  for (let i = 0; i < 4; i++) {
    const got = getZonedParts(new Date(guess), tz);
    const gotDay = Date.UTC(got.year, got.month - 1, got.day);
    const wantDay = Date.UTC(day.year, day.month - 1, day.day);
    const msDiff =
      gotDay - wantDay + ((got.hour - wantH) * 60 + (got.minute - wantM)) * 60_000 + got.second * 1000;
    if (msDiff === 0) break;
    guess -= msDiff;
  }
  return guess;
}

/**
 * True when synced now is at/after the callout's absolute UTC instant (event wall clock),
 * within `graceMinutes` (covers background-tab timer throttling).
 */
export function isCalloutDue(
  calloutTime: string,
  syncedNow: Date,
  timeZone?: string | null,
  graceMinutes = 10
): boolean {
  const dueMs = eventWallClockToUtcMs(calloutTime, timeZone, syncedNow);
  if (dueMs == null) return false;
  const delta = syncedNow.getTime() - dueMs;
  return delta >= 0 && delta <= Math.max(0, graceMinutes) * 60_000;
}

/**
 * True when synced now is inside a short window starting at
 * (wall-clock time − minutesBefore). Used for “5 minutes before start” prompts.
 */
export function isMinutesBeforeWallClock(
  wallClockLabel: string,
  syncedNow: Date,
  timeZone: string | null | undefined,
  minutesBefore: number,
  windowSeconds = 90
): boolean {
  const dueMs = eventWallClockToUtcMs(wallClockLabel, timeZone, syncedNow);
  if (dueMs == null) return false;
  const targetMs = dueMs - Math.max(0, minutesBefore) * 60_000;
  const delta = syncedNow.getTime() - targetMs;
  return delta >= 0 && delta <= Math.max(0, windowSeconds) * 1000;
}

/** Absolute UTC ms for a venue wall-clock label, or null if unparseable. */
export function wallClockStartUtcMs(
  wallClockLabel: string,
  syncedNow: Date,
  timeZone?: string | null
): number | null {
  return eventWallClockToUtcMs(wallClockLabel, timeZone, syncedNow);
}
