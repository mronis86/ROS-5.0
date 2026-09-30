import { isIndentedScheduleItem, type IndentedCueLookup } from './scheduleStartTime';

type CueLike = {
  id: number;
  programType?: string;
  day?: number;
  isIndented?: boolean;
  isTimedMarker?: boolean;
};

export function isPreshowProgramType(programType: string | null | undefined): boolean {
  const t = String(programType || '').trim();
  return t === 'PreShow' || t === 'PreShow/End';
}

/**
 * First non-indented cue for a day (or the whole schedule), only if it is PreShow
 * (or legacy PreShow/End).
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
    if (item.isTimedMarker || isIndentedScheduleItem(item, indentedLookup || {})) continue;
    if (isPreshowProgramType(item.programType)) return item;
    return null;
  }
  return null;
}
