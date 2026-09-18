/** Audience / display copy for show-start offset (★ Root late/early minutes). */
export function formatShowDelayBanner(minutes: number): string | null {
  const n = Math.round(Number(minutes) || 0);
  if (n === 0) return null;
  if (n > 0) return `Delayed +${n} min`;
  return `Early ${n} min`;
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
