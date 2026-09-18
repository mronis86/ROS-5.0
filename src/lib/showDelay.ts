/** Audience / display copy for show-start offset (★ Root late/early minutes). */
export function formatShowDelayBanner(minutes: number): string | null {
  const n = Math.round(Number(minutes) || 0);
  if (n === 0) return null;
  if (n > 0) return `Delayed +${n} min`;
  return `Early ${n} min`;
}

/** Timer status line (Green Room / Photo) — uppercase; replaces OVER TIME when delayed. */
export function formatShowDelayStatus(minutes: number): string | null {
  const n = Math.round(Number(minutes) || 0);
  if (n === 0) return null;
  if (n > 0) return `DELAYED +${n} MIN`;
  return `EARLY ${n} MIN`;
}

/** Minutes past scheduled cue duration (negative remaining → positive delay). */
export function cueOverrunDelayMinutes(remainingSeconds: number): number {
  if (!(remainingSeconds < 0)) return 0;
  return Math.max(1, Math.ceil(Math.abs(remainingSeconds) / 60));
}

/**
 * Audience-facing delay minutes for Green Room timer chrome.
 * Prefer ★ Root offset + Delay Blocks above ★; else cue overrun past zero.
 */
export function resolveGreenRoomDelayMinutes(opts: {
  showStartOvertime?: number | null;
  /** Sum of Delay Block durations above ★ START (minutes). */
  scheduleDelayMinutes?: number | null;
  remainingSeconds?: number | null;
  timerRunning?: boolean;
}): number {
  const root = Math.round(Number(opts.showStartOvertime) || 0);
  const scheduleDelay = Math.max(0, Math.round(Number(opts.scheduleDelayMinutes) || 0));
  const combined = scheduleDelay + root;
  if (combined !== 0) return combined;
  if (!opts.timerRunning) return 0;
  const rem = Number(opts.remainingSeconds);
  if (!Number.isFinite(rem)) return 0;
  return cueOverrunDelayMinutes(rem);
}

type DelayScheduleItem = {
  id: number;
  day?: number;
  programType?: string;
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
  /** Alternate total-seconds field from some API payloads */
  duration_seconds?: number;
  isIndented?: boolean;
  isStartCue?: boolean;
};

function itemDurationSeconds(item: DelayScheduleItem): number {
  const fromParts =
    (Number(item.durationHours) || 0) * 3600 +
    (Number(item.durationMinutes) || 0) * 60 +
    (Number(item.durationSeconds) || 0);
  if (fromParts > 0) return fromParts;
  const alt = Number(item.duration_seconds);
  return Number.isFinite(alt) && alt > 0 ? alt : 0;
}

/**
 * Minutes from Delay Block rows that sit above the ★ START cue
 * (typical layout: PreShow → Delay Block → ★ START → …).
 * If a top PreShow/End exists, only Delay Blocks after it (and before ★) count.
 * When ★ is missing, only consecutive Delay Blocks right after PreShow count.
 */
export function sumPreStartDelayBlockMinutes(opts: {
  schedule: DelayScheduleItem[];
  startCueId?: number | null;
  /** Limit scan to one day (START / PreShow day). */
  day?: number | null;
  /** When set, skip indented rows */
  indentedIds?: Set<number> | Record<number, unknown> | null;
}): number {
  const raw = opts.schedule || [];
  if (!raw.length) return 0;

  const indented = opts.indentedIds;
  const isIndented = (id: number, item: DelayScheduleItem) => {
    if (item.isIndented) return true;
    if (!indented) return false;
    if (indented instanceof Set) return indented.has(id);
    return indented[id] != null;
  };

  let day = opts.day;
  if (day == null && opts.startCueId != null) {
    const startRow = raw.find((s) => Number(s.id) === Number(opts.startCueId));
    if (startRow?.day != null) day = Number(startRow.day);
  }

  const schedule =
    day != null ? raw.filter((s) => Number(s.day ?? 1) === Number(day)) : raw;
  if (!schedule.length) return 0;

  let endIdx = schedule.length;
  if (opts.startCueId != null) {
    const startIdx = schedule.findIndex((s) => Number(s.id) === Number(opts.startCueId));
    if (startIdx >= 0) endIdx = startIdx;
    else {
      const startIdxFull = raw.findIndex((s) => Number(s.id) === Number(opts.startCueId));
      if (startIdxFull < 0) return 0;
      // START on another day — no pre-start delay for this day slice
      return 0;
    }
  }

  let startScan = 0;
  for (let i = 0; i < endIdx; i++) {
    const item = schedule[i];
    if (!item || isIndented(item.id, item)) continue;
    if (item.programType === 'PreShow/End') {
      startScan = i + 1;
      break;
    }
  }

  // No ★: only count Delay Blocks that sit immediately after PreShow
  // until the next real (non-delay) cue.
  if (opts.startCueId == null) {
    let foundDelay = false;
    for (let i = startScan; i < schedule.length; i++) {
      const item = schedule[i];
      if (!item || isIndented(item.id, item)) continue;
      if (item.programType === 'Delay Block') {
        foundDelay = true;
        continue;
      }
      if (item.programType === 'PreShow/End') continue;
      endIdx = foundDelay ? i : startScan;
      break;
    }
  }

  let totalSec = 0;
  for (let i = startScan; i < endIdx; i++) {
    const item = schedule[i];
    if (!item || item.programType !== 'Delay Block') continue;
    if (isIndented(item.id, item)) continue;
    totalSec += itemDurationSeconds(item);
  }

  if (totalSec <= 0) return 0;
  return Math.max(1, Math.round(totalSec / 60));
}

/** Normalize API / socket payloads for show-start offset minutes. */
export function parseShowStartOvertimeMinutes(data: unknown): number {
  if (data == null || typeof data !== 'object') return 0;
  const row = data as Record<string, unknown>;
  const raw =
    row.showStartOvertime ??
    row.show_start_overtime ??
    row.overtimeMinutes ??
    row.overtime_minutes ??
    0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * True when PreShow sits above the ★ START cue so its duration OT does not
 * cascade via per-cue overtime — fold into showStartOvertime instead.
 */
export function shouldFoldPreshowOvertimeIntoShowStart(opts: {
  schedule: Array<{ id: number }>;
  preshowItemId: number;
  startCueId: number | null | undefined;
}): boolean {
  if (opts.startCueId == null) return false;
  const preshowIdx = opts.schedule.findIndex((s) => Number(s.id) === Number(opts.preshowItemId));
  const startIdx = opts.schedule.findIndex((s) => Number(s.id) === Number(opts.startCueId));
  return preshowIdx >= 0 && startIdx > preshowIdx;
}
