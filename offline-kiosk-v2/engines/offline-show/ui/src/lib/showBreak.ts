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
  id?: number;
  day?: number;
  programType?: string;
  /** Pinned HH:MM on the first cue after a Show Break. */
  sessionStartTime?: string | null;
  /** Legacy restart clock stored on the break row. */
  breakStartTime?: string | null;
  /** Start Section toggle is ON — rows above are frozen. */
  sectionStarted?: boolean;
};

/** Latest Show Break whose Start Section toggle is ON, or -1. */
export function activeShowSectionBreakIndex(schedule: BreakRow[]): number {
  for (let i = schedule.length - 1; i >= 0; i--) {
    if (isShowBreakProgramType(schedule[i]?.programType) && schedule[i].sectionStarted) {
      return i;
    }
  }
  return -1;
}

/** True when this row sits above an active Start Section break (offsets stay frozen). */
export function isIndexFrozenByShowSection(schedule: BreakRow[], index: number): boolean {
  const breakIdx = activeShowSectionBreakIndex(schedule);
  if (breakIdx < 0 || index < 0) return false;
  const row = schedule[index];
  const br = schedule[breakIdx];
  if (!row || !br) return false;
  if ((row.day || 1) !== (br.day || 1)) return false;
  return index < breakIdx;
}

/** True when this row is in the active session below a Start Section break. */
export function isIndexInActiveShowSection(schedule: BreakRow[], index: number): boolean {
  const breakIdx = activeShowSectionBreakIndex(schedule);
  if (breakIdx < 0 || index < 0) return false;
  const row = schedule[index];
  const br = schedule[breakIdx];
  if (!row || !br) return false;
  if ((row.day || 1) !== (br.day || 1)) return false;
  return index > breakIdx;
}

/** First real cue after a Show Break on this day, or -1. */
export function firstSessionCueIndexAfter(
  schedule: BreakRow[],
  breakIndex: number,
  day: number,
  countsToward: (row: BreakRow, index: number) => boolean
): number {
  for (let i = breakIndex + 1; i < schedule.length; i++) {
    const row = schedule[i];
    if (!row || (row.day || 1) !== day) continue;
    if (isShowBreakProgramType(row.programType)) continue;
    if (countsToward(row, i)) return i;
  }
  return -1;
}

/** First real cue after this Show Break, or null. */
export function nextSessionCueOf<T extends BreakRow>(
  schedule: T[],
  breakIndex: number,
  countsToward: (row: T, index: number) => boolean
): { index: number; item: T } | null {
  const row = schedule[breakIndex];
  if (!row || !isShowBreakProgramType(row.programType)) return null;
  const day = row.day || 1;
  const counted = firstSessionCueIndexAfter(schedule, breakIndex, day, countsToward);
  if (counted >= 0) return { index: counted, item: schedule[counted] };
  for (let i = breakIndex + 1; i < schedule.length; i++) {
    const next = schedule[i];
    if (!next || (next.day || 1) !== day) continue;
    if (isShowBreakProgramType(next.programType)) continue;
    return { index: i, item: next };
  }
  return null;
}

export function sessionStartTimeOf(row?: BreakRow | null): string {
  return normalizeBreakStartTime(row?.sessionStartTime || row?.breakStartTime);
}

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
