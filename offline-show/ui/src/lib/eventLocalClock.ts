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
    const parts = new Intl.DateTimeFormat('en-US', {
      ...(tz ? { timeZone: tz } : {}),
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    let hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
    if (hh === '24') hh = '00';
    return `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
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
