import { isIndentedScheduleItem, type IndentedCueLookup } from './scheduleStartTime';
import { isShowBreakProgramType } from './showBreak';

/** Canonical open / close program types (replaces legacy "PreShow/End"). */
export const PRESHOW_PROGRAM_TYPE = 'PreShow';
export const ENDSHOW_PROGRAM_TYPE = 'EndShow';
/** Legacy combined type — still accepted on read and rewritten on normalize. */
export const LEGACY_PRESHOW_END_PROGRAM_TYPE = 'PreShow/End';

/**
 * How many non–Timed Marker / non-indented cues after the session’s first PreShow
 * before a new PreShow looks like a mistaken EndShow.
 */
export const PRESHOW_ENDSHOW_WARN_AFTER_REGULAR_ROWS = 2;

/** Diagonal hash so EndShow matches PreShow purple but reads as a different cue. */
export const ENDSHOW_STRIPE_BACKGROUND_IMAGE =
  'repeating-linear-gradient(135deg, rgba(255,255,255,0.22) 0 5px, rgba(0,0,0,0.14) 5px 10px)';

/** Fill style for program-type chips/selects — EndShow gets stripes on PreShow purple. */
export function programTypeSurfaceStyle(
  programType: string | null | undefined,
  colors: Record<string, string>,
  fallback = '#374151'
): { backgroundColor: string; backgroundImage?: string } {
  const type = String(programType || '').trim();
  const backgroundColor = colors[type] || fallback;
  if (type === ENDSHOW_PROGRAM_TYPE) {
    return {
      backgroundColor,
      backgroundImage: ENDSHOW_STRIPE_BACKGROUND_IMAGE,
    };
  }
  return { backgroundColor };
}

/** Chip text on ROS program-type fills — light types need dark type. */
export function programTypeTextColor(programType: string | null | undefined): string {
  const type = String(programType || '').trim();
  if (type === 'Sub Cue') return '#111827';
  return '#ffffff';
}

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

type PreshowWarnCue = NormalizeCue & { id: number };

function sessionStartIndexBefore(
  schedule: PreshowWarnCue[],
  targetIndex: number,
  day: number
): number {
  for (let i = targetIndex - 1; i >= 0; i--) {
    const row = schedule[i];
    if (!row) continue;
    if ((Number(row.day) || 1) !== day) return i + 1;
    if (isShowBreakProgramType(row.programType)) return i + 1;
  }
  return 0;
}

/**
 * True when setting this row to PreShow likely means EndShow:
 * same session already has a PreShow, and more than N regular (non–Timed Marker /
 * non-indented) cues sit between that first PreShow and this row.
 * Show Break starts a new session (PreShow after a break is allowed).
 */
export function shouldSuggestEndShowInsteadOfPreshow(
  schedule: PreshowWarnCue[] | null | undefined,
  opts: {
    itemId?: number | null;
    /** When the row is not in the schedule yet (add modal), treat as this index. */
    atIndex?: number | null;
    day?: number | null;
    indentedLookup?: IndentedCueLookup | null;
    minRegularBetween?: number;
  } = {}
): boolean {
  if (!Array.isArray(schedule) || schedule.length === 0) return false;

  const indentedLookup = opts.indentedLookup || {};
  const minBetween =
    opts.minRegularBetween != null && Number.isFinite(Number(opts.minRegularBetween))
      ? Math.max(0, Math.floor(Number(opts.minRegularBetween)))
      : PRESHOW_ENDSHOW_WARN_AFTER_REGULAR_ROWS;

  let targetIndex =
    opts.atIndex != null && Number.isFinite(Number(opts.atIndex))
      ? Math.max(0, Math.floor(Number(opts.atIndex)))
      : -1;
  if (opts.itemId != null) {
    const found = schedule.findIndex((row) => Number(row.id) === Number(opts.itemId));
    if (found >= 0) targetIndex = found;
  }
  if (targetIndex < 0) targetIndex = schedule.length;
  if (targetIndex > schedule.length) targetIndex = schedule.length;

  const target = targetIndex < schedule.length ? schedule[targetIndex] : null;
  if (target) {
    if (target.isTimedMarker || isIndentedScheduleItem(target as any, indentedLookup)) {
      return false;
    }
  }

  const day =
    opts.day != null && Number.isFinite(Number(opts.day))
      ? Math.floor(Number(opts.day))
      : Number(target?.day) || 1;

  const sessionStart = sessionStartIndexBefore(schedule, targetIndex, day);

  let firstPreshowIdx = -1;
  for (let i = sessionStart; i < targetIndex; i++) {
    const row = schedule[i];
    if (!row) continue;
    if ((Number(row.day) || 1) !== day) continue;
    if (row.isTimedMarker || isIndentedScheduleItem(row as any, indentedLookup)) continue;
    if (isShowBreakProgramType(row.programType)) continue;
    if (isPreshowProgramType(row.programType)) {
      firstPreshowIdx = i;
      break;
    }
  }
  if (firstPreshowIdx < 0) return false;

  let regularBetween = 0;
  for (let i = firstPreshowIdx + 1; i < targetIndex; i++) {
    const row = schedule[i];
    if (!row) continue;
    if ((Number(row.day) || 1) !== day) continue;
    if (row.isTimedMarker || isIndentedScheduleItem(row as any, indentedLookup)) continue;
    if (isShowBreakProgramType(row.programType)) continue;
    regularBetween += 1;
  }

  return regularBetween > minBetween;
}

/**
 * Pass-through helper. PreShow → EndShow mid-show confirmation is handled by
 * `PreshowEndShowWarnModal` at the call site (not a browser confirm).
 */
export function resolvePreshowProgramTypeSelection(
  nextType: string,
  _schedule?: PreshowWarnCue[] | null,
  _opts?: {
    itemId?: number | null;
    atIndex?: number | null;
    day?: number | null;
    indentedLookup?: IndentedCueLookup | null;
    minRegularBetween?: number;
  }
): string {
  return nextType;
}

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
