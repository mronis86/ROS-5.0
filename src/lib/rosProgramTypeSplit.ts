import { isIndentedScheduleItem, type IndentedCueLookup } from './scheduleStartTime';

/** Canonical open / close program types (replaces legacy "PreShow/End"). */
export const PRESHOW_PROGRAM_TYPE = 'PreShow';
export const ENDSHOW_PROGRAM_TYPE = 'EndShow';
/** Legacy combined type — still accepted on read and rewritten on normalize. */
export const LEGACY_PRESHOW_END_PROGRAM_TYPE = 'PreShow/End';

export function isPreshowProgramType(programType: string | null | undefined): boolean {
  const t = String(programType || '').trim();
  return t === PRESHOW_PROGRAM_TYPE || t === LEGACY_PRESHOW_END_PROGRAM_TYPE;
}

export function isEndShowProgramType(programType: string | null | undefined): boolean {
  return String(programType || '').trim() === ENDSHOW_PROGRAM_TYPE;
}

/** True for PreShow, EndShow, or legacy PreShow/End. */
export function isPreshowOrEndShowProgramType(programType: string | null | undefined): boolean {
  return isPreshowProgramType(programType) || isEndShowProgramType(programType);
}

type NormalizeCue = {
  id?: number;
  day?: number;
  programType?: string;
  isIndented?: boolean;
  isTimedMarker?: boolean;
};

/**
 * Rewrite legacy PreShow/End per day:
 * - first non-indented PreShow/End (or existing PreShow) → PreShow
 * - later PreShow/End → EndShow
 * Explicit PreShow / EndShow rows are left alone (except first legacy → PreShow).
 */
export function normalizeSchedulePreshowEndTypes<T extends NormalizeCue>(
  schedule: T[],
  indentedLookup?: IndentedCueLookup | null
): T[] {
  if (!Array.isArray(schedule) || schedule.length === 0) return schedule;

  const seenPreshowByDay = new Set<number>();
  let changed = false;

  const next = schedule.map((item) => {
    const type = String(item.programType || '').trim();
    if (!type) return item;
    if (item.isTimedMarker || isIndentedScheduleItem(item as any, indentedLookup || {})) {
      return item;
    }

    const day = Number(item.day) || 1;

    if (type === PRESHOW_PROGRAM_TYPE) {
      seenPreshowByDay.add(day);
      return item;
    }

    if (type !== LEGACY_PRESHOW_END_PROGRAM_TYPE) return item;

    if (!seenPreshowByDay.has(day)) {
      seenPreshowByDay.add(day);
      changed = true;
      return { ...item, programType: PRESHOW_PROGRAM_TYPE };
    }

    changed = true;
    return { ...item, programType: ENDSHOW_PROGRAM_TYPE };
  });

  return changed ? next : schedule;
}
