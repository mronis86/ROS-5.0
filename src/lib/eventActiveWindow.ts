/** Local calendar-day helpers for upcoming vs past event lists. */

export function startOfTodayLocal(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Parse YYYY-MM-DD as a local calendar date (no UTC shift). */
export function parseEventDateLocal(dateStr: string): Date | null {
  const parts = String(dateStr || '')
    .trim()
    .split('-')
    .map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/**
 * Last calendar day of an event.
 * 1-day event starting 8/5 → ends 8/5.
 * 2-day event starting 8/5 → ends 8/6.
 */
export function getEventLastDay(start: Date, numberOfDays?: number | null): Date {
  const days = Math.max(1, Math.floor(Number(numberOfDays) || 1));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  end.setDate(end.getDate() + (days - 1));
  return end;
}

/** Still active/upcoming through the last day (inclusive). */
export function isEventUpcoming(
  dateStr: string,
  numberOfDays?: number | null,
  today: Date = startOfTodayLocal()
): boolean {
  const start = parseEventDateLocal(dateStr);
  if (!start) return true;
  return getEventLastDay(start, numberOfDays) >= today;
}

/** Past only after the last day has ended. */
export function isEventPast(
  dateStr: string,
  numberOfDays?: number | null,
  today: Date = startOfTodayLocal()
): boolean {
  const start = parseEventDateLocal(dateStr);
  if (!start) return false;
  return getEventLastDay(start, numberOfDays) < today;
}
