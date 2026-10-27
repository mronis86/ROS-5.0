/** Insertable session split — looks like Delay, but starts a new clock. */

export const SHOW_BREAK_PROGRAM_TYPE = 'Show Break';

export function isShowBreakProgramType(programType?: string | null): boolean {
  return String(programType || '').trim().toLowerCase() === 'show break';
}

export function isScheduleOnlyProgramType(programType?: string | null): boolean {
  const t = String(programType || '').trim().toLowerCase();
  return t === 'delay block' || t === 'show break';
}

/** "17:15", "17:15:00", or "5:15 PM" → seconds since midnight. */
export function parseBreakStartTimeToSeconds(value: unknown): number | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (ampm) {
    let hours = Number(ampm[1]);
    const minutes = Number(ampm[2]);
    const seconds = Number(ampm[3] || 0);
    const mer = ampm[4].toLowerCase();
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (mer === 'pm' && hours < 12) hours += 12;
    if (mer === 'am' && hours === 12) hours = 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  const parts = raw.split(':').map(Number);
  const hours = parts[0];
  const minutes = parts[1];
  const seconds = Number.isFinite(parts[2]) ? parts[2] : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function normalizeBreakStartTime(value: unknown): string {
  const sec = parseBreakStartTimeToSeconds(value);
  if (sec == null) return '';
  const hours = Math.floor(sec / 3600) % 24;
  const minutes = Math.floor((sec % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

type BreakRow = {
  day?: number;
  programType?: string;
  breakStartTime?: string | null;
};

/** Latest Show Break on this day before `index`, or -1. */
export function lastShowBreakIndexBefore(
  schedule: BreakRow[],
  index: number,
  day: number
): number {
  for (let i = index - 1; i >= 0; i--) {
    const row = schedule[i];
    if (!row) continue;
    if ((row.day || 1) !== day) continue;
    if (isShowBreakProgramType(row.programType)) return i;
  }
  return -1;
}

export function sameShowSession(
  schedule: BreakRow[],
  leftIndex: number,
  rightIndex: number
): boolean {
  const left = schedule[leftIndex];
  const right = schedule[rightIndex];
  if (!left || !right) return false;
  const leftDay = left.day || 1;
  const rightDay = right.day || 1;
  if (leftDay !== rightDay) return false;
  return (
    lastShowBreakIndexBefore(schedule, leftIndex, leftDay) ===
    lastShowBreakIndexBefore(schedule, rightIndex, rightDay)
  );
}

export function breakStartTimeOf(row?: BreakRow | null): string {
  return normalizeBreakStartTime(row?.breakStartTime);
}
