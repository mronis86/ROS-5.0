/** Offline stub: day-index helper used by preshowCountdown (full checklist not shipped offline). */

export function getEventDayNumberForDate(
  eventDate?: string | null,
  numberOfDays = 1,
  now: Date = new Date()
): number | null {
  if (!eventDate) return null;
  const start = new Date(`${String(eventDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const days = Math.max(1, Math.floor(Number(numberOfDays) || 1));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = today.getTime() - start.getTime();
  const dayIndex = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (dayIndex < 0 || dayIndex >= days) return null;
  return dayIndex + 1;
}
