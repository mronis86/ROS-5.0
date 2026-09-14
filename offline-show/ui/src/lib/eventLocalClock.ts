/**
 * Event-local wall clock helpers for VO/MUSIC alerts and similar show-time UI.
 * Prefer server-synced Date.now()+clockOffset, then format in the event timezone
 * — never browser getHours()/getMinutes() alone.
 */

export function getSyncedNow(clockOffsetMs = 0): Date {
  return new Date(Date.now() + (Number.isFinite(clockOffsetMs) ? clockOffsetMs : 0));
}

/** "HH:MM" (24h) for `date` in `timeZone`. Falls back to the date's local zone if tz is empty/invalid. */
export function getEventLocalHHMM(date: Date, timeZone?: string | null): string {
  const tz = typeof timeZone === 'string' ? timeZone.trim() : '';
  try {
    // en-GB + hour12:false avoids en-US quirks that can emit 12h hours for afternoon times.
    const parts = new Intl.DateTimeFormat('en-GB', {
      ...(tz ? { timeZone: tz } : {}),
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    let hh = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
    const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value?.toLowerCase();
    if (Number.isFinite(hh) && dayPeriod) {
      if (dayPeriod.startsWith('p') && hh < 12) hh += 12;
      if (dayPeriod.startsWith('a') && hh === 12) hh = 0;
    }
    if (!Number.isFinite(hh)) hh = 0;
    if (hh === 24) hh = 0;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  } catch {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
}

/** Minutes since midnight from "HH:MM" (24h). */
export function hhmmToMinutes(hhmm: string): number | null {
  const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes since midnight from schedule labels like "1:30 PM" or "13:30". */
export function wallClockLabelToMinutes(label: string): number | null {
  const raw = String(label || '').trim();
  if (!raw) return null;
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
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
 * True when event-local now is at the callout minute, or within `graceMinutes` after
 * (covers background-tab timer throttling so the toast is not missed forever).
 */
export function isCalloutDue(
  calloutTime: string,
  eventLocalHHMM: string,
  graceMinutes = 10
): boolean {
  const calloutMins = wallClockLabelToMinutes(calloutTime);
  const nowMins = hhmmToMinutes(eventLocalHHMM);
  if (calloutMins == null || nowMins == null) return false;
  let delta = nowMins - calloutMins;
  if (delta < 0) delta += 24 * 60;
  return delta >= 0 && delta <= Math.max(0, graceMinutes);
}
