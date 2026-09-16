/**
 * Event-local wall clock helpers for VO/MUSIC alerts and similar show-time UI.
 * Prefer server-synced Date.now()+clockOffset, then format in the event timezone
 * — never browser getHours()/getMinutes() alone.
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

/** "HH:MM" (24h) for `date` in `timeZone`. Never silently uses the browser zone when a tz was requested. */
export function getEventLocalHHMM(date: Date, timeZone?: string | null): string {
  const requested = typeof timeZone === 'string' ? timeZone.trim() : '';
  const tz = resolveShowTimezone(requested || null);

  const formatParts = (zone: string) => {
    // hourCycle h23 is more reliable across engines than hour12:false alone.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
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
  };

  try {
    return formatParts(tz);
  } catch {
    try {
      return formatParts('America/New_York');
    } catch {
      // Absolute last resort — still prefer UTC wall clock over a random laptop zone.
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
  const raw = String(label || '').trim();
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
