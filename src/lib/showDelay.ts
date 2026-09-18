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
 * Prefer ★ Root show-start offset; otherwise cue overrun while running past zero.
 */
export function resolveGreenRoomDelayMinutes(opts: {
  showStartOvertime?: number | null;
  remainingSeconds?: number | null;
  timerRunning?: boolean;
}): number {
  const root = Math.round(Number(opts.showStartOvertime) || 0);
  if (root !== 0) return root;
  if (!opts.timerRunning) return 0;
  const rem = Number(opts.remainingSeconds);
  if (!Number.isFinite(rem)) return 0;
  return cueOverrunDelayMinutes(rem);
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
