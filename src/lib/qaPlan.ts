/** Planned Q&A timer row under a parent ROS cue (marker-style, not a Sub Cue / ALT). */

export type QaStartMode = 'end' | 'remaining';

/** How Q&A appears on stage displays while the parent cue runs. */
export type QaDisplayMode = 'sub' | 'flash';

export function isQaPlanRow(item: { qaIsAutoQa?: boolean } | null | undefined): boolean {
  return item?.qaIsAutoQa === true;
}

export function isQaFlashPlan(item: {
  hasQA?: boolean;
  qaDisplayMode?: QaDisplayMode | string | null;
} | null | undefined): boolean {
  return !!item?.hasQA && String(item.qaDisplayMode || '').toLowerCase() === 'flash';
}

export type QaPlanDraft = {
  label: string;
  /** Q&A length in seconds (sub timer duration; also informs flash threshold in "end" mode). */
  durationSeconds: number;
  startMode: QaStartMode;
  /**
   * When startMode === 'remaining': start Q&A when parent remaining reaches this.
   * Ignored for 'end' (uses durationSeconds as the remaining threshold).
   */
  startAtRemainingSeconds: number;
  autoStart: boolean;
  /** Sub timer (indented row) or flash reminder on displays (no secondary timer). */
  displayMode: QaDisplayMode;
};

export type QaPlanModalResult = QaPlanDraft & {
  /** Effective remaining threshold used for auto-start / flash. */
  startAtRemainingSeconds: number;
};

export function parentDurationSeconds(item: {
  durationHours?: number | null;
  durationMinutes?: number | null;
  durationSeconds?: number | null;
}): number {
  return (
    Math.max(0, Math.floor(Number(item.durationHours) || 0)) * 3600 +
    Math.max(0, Math.floor(Number(item.durationMinutes) || 0)) * 60 +
    Math.max(0, Math.floor(Number(item.durationSeconds) || 0))
  );
}

export function clampQaDurationSeconds(seconds: number, parentTotal: number): number {
  const n = Math.max(1, Math.floor(Number(seconds) || 0));
  if (parentTotal > 0) return Math.min(n, parentTotal);
  return n;
}

export function resolveQaStartAtRemaining(draft: QaPlanDraft, parentTotal: number): number {
  const duration = clampQaDurationSeconds(draft.durationSeconds, parentTotal);
  if (draft.startMode === 'end') return duration;
  const at = Math.max(duration, Math.floor(Number(draft.startAtRemainingSeconds) || 0));
  if (parentTotal > 0) return Math.min(at, parentTotal);
  return at;
}

/**
 * Wall-clock ms when parent remaining first reaches `thresholdSeconds`
 * (i.e. elapsed >= total - threshold). Null if inputs are unusable.
 */
export function qaAutoStartDueAtMs(
  parentStartedAtMs: number | null | undefined,
  parentTotalSeconds: number | null | undefined,
  thresholdSeconds: number | null | undefined
): number | null {
  const started = Number(parentStartedAtMs);
  const total = Number(parentTotalSeconds);
  const threshold = Number(thresholdSeconds);
  if (!Number.isFinite(started) || started <= 0) return null;
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(threshold) || threshold < 0) return null;
  if (threshold > total) return null;
  // At least 1s into the parent so LOAD/START never qualifies.
  const elapsedNeeded = Math.max(1, total - threshold);
  return started + elapsedNeeded * 1000;
}

/**
 * Prefer this over remaining polls: uses parent started_at + schedule duration,
 * so stale hybrid progress from the previous cue cannot fire Q&A at parent START.
 */
export function shouldAutoStartQaAtWallClock(opts: {
  parentRunning: boolean;
  parentStartedAtMs: number | null | undefined;
  parentTotalSeconds: number | null | undefined;
  thresholdSeconds: number | null | undefined;
  nowMs: number;
}): boolean {
  if (!opts.parentRunning) return false;
  const due = qaAutoStartDueAtMs(
    opts.parentStartedAtMs,
    opts.parentTotalSeconds,
    opts.thresholdSeconds
  );
  if (due == null) return false;
  const now = Number(opts.nowMs);
  if (!Number.isFinite(now)) return false;
  return now >= due;
}

/**
 * Gate Q&A auto-start on a real running parent countdown that has known duration.
 *
 * Rejects:
 * - parent not actively counting (caller must pass is_running / ticking, not merely LOADED)
 * - unknown / zero total (incl. hybrid progress still {0,0} on LOAD)
 * - remaining === total (LOAD or just-STARTED — never auto-start at full duration)
 * - remaining above the configured threshold
 * - elapsed < 1s (blocks the START tick before the clock has moved)
 * - progress total that does not match the parent schedule duration (stale prior-cue hybrid)
 */
export function shouldAutoStartQa(opts: {
  /** Must mean the parent timer is actively counting down (is_running), not merely loaded/active. */
  parentRunning: boolean;
  parentRemainingSeconds: number | null | undefined;
  parentTotalSeconds: number | null | undefined;
  thresholdSeconds: number | null | undefined;
  /** Optional explicit elapsed; otherwise derived as total - remaining. */
  parentElapsedSeconds?: number | null | undefined;
  /**
   * Schedule duration for the parent cue. When set, progress total must match
   * (within 1s) — blocks using the previous cue's hybrid countdown at START.
   */
  expectedParentTotalSeconds?: number | null | undefined;
}): boolean {
  if (!opts.parentRunning) return false;
  const total = Number(opts.parentTotalSeconds);
  const remaining = Number(opts.parentRemainingSeconds);
  const threshold = Number(opts.thresholdSeconds);
  if (!Number.isFinite(total) || total <= 0) return false;
  if (!Number.isFinite(remaining)) return false;
  if (!Number.isFinite(threshold) || threshold < 0) return false;
  const expected = Number(opts.expectedParentTotalSeconds);
  if (Number.isFinite(expected) && expected > 0 && Math.abs(total - expected) > 1) {
    return false;
  }
  // Strictly past start: LOAD/START both have remaining === total.
  if (!(remaining < total)) return false;
  if (!(remaining <= threshold)) return false;
  const elapsed =
    opts.parentElapsedSeconds != null && Number.isFinite(Number(opts.parentElapsedSeconds))
      ? Number(opts.parentElapsedSeconds)
      : total - remaining;
  if (!(elapsed >= 1)) return false;
  return true;
}

/**
 * Flash reminder: parent RUNNING and remaining <= threshold.
 * Same gate as auto-start so LOAD/START at full duration never flashes early.
 * Callers should also pass expectedParentTotalSeconds and/or use wall-clock
 * so stale hybrid progress from the previous cue cannot flash at START.
 * The on-stage hook ends the flash after qaFlashDurationSeconds.
 */
export function shouldShowQaFlashReminder(opts: {
  parentRunning: boolean;
  parentRemainingSeconds: number | null | undefined;
  parentTotalSeconds: number | null | undefined;
  thresholdSeconds: number | null | undefined;
  parentElapsedSeconds?: number | null | undefined;
  expectedParentTotalSeconds?: number | null | undefined;
}): boolean {
  const remaining = Number(opts.parentRemainingSeconds);
  if (Number.isFinite(remaining) && remaining <= 0) return false;
  return shouldAutoStartQa(opts);
}

/**
 * True when the flash window should arm (threshold crossed). Prefers wall-clock
 * from parent started_at; falls back to remaining poll with stale-total guard.
 */
export function shouldArmQaFlash(opts: {
  parentRunning: boolean;
  parentStartedAtMs: number | null | undefined;
  parentRemainingSeconds: number | null | undefined;
  parentTotalSeconds: number | null | undefined;
  thresholdSeconds: number | null | undefined;
  parentElapsedSeconds?: number | null | undefined;
  expectedParentTotalSeconds?: number | null | undefined;
  nowMs: number;
}): boolean {
  const expected = Number(opts.expectedParentTotalSeconds);
  const wallTotal =
    Number.isFinite(expected) && expected > 0
      ? expected
      : Number(opts.parentTotalSeconds) || 0;
  if (
    opts.parentStartedAtMs != null &&
    wallTotal > 0 &&
    shouldAutoStartQaAtWallClock({
      parentRunning: opts.parentRunning,
      parentStartedAtMs: opts.parentStartedAtMs,
      parentTotalSeconds: wallTotal,
      thresholdSeconds: opts.thresholdSeconds,
      nowMs: opts.nowMs,
    })
  ) {
    return true;
  }
  return shouldShowQaFlashReminder(opts);
}

/** How long the full "Q&A - MM:SS" line pulses before settling steady. */
export const QA_FLASH_PULSE_MS = 30_000;

/** Stage countdown line while Q&A flash is active, e.g. "Q&A - 10:00". */
export function formatQaFlashCountdownLine(label: string, timeBody: string): string {
  const text = String(label || 'Q&A').trim() || 'Q&A';
  const time = String(timeBody || '').trim();
  return time ? `${text} - ${time}` : text;
}

export function isQaFlashPulsing(
  startedAtMs: number | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (startedAtMs == null || !Number.isFinite(Number(startedAtMs))) return false;
  return nowMs - Number(startedAtMs) < QA_FLASH_PULSE_MS;
}

/** Flash plan fields stored on the parent cue (no linked sub row). */
export type QaFlashPlanFields = {
  qaDisplayMode: 'flash';
  qaFlashLabel: string;
  qaFlashAtRemainingSeconds: number;
  qaFlashAuto: boolean;
  qaFlashDurationSeconds: number;
};

export function flashPlanFromParent(item: {
  qaFlashLabel?: string | null;
  qaFlashAtRemainingSeconds?: number | null;
  qaFlashAuto?: boolean | null;
  qaFlashDurationSeconds?: number | null;
  qaAutoStartAtRemainingSeconds?: number | null;
} | null | undefined): {
  label: string;
  thresholdSeconds: number;
  auto: boolean;
  durationSeconds: number;
} | null {
  if (!item) return null;
  const threshold = Number(
    item.qaFlashAtRemainingSeconds ?? item.qaAutoStartAtRemainingSeconds
  );
  if (!Number.isFinite(threshold) || threshold < 0) return null;
  return {
    label: String(item.qaFlashLabel || 'Q&A').trim() || 'Q&A',
    thresholdSeconds: threshold,
    auto: item.qaFlashAuto !== false,
    durationSeconds: Math.max(0, Math.floor(Number(item.qaFlashDurationSeconds) || 0)),
  };
}

export function clearQaFlashFields<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    qaDisplayMode: null,
    qaFlashLabel: null,
    qaFlashAtRemainingSeconds: null,
    qaFlashAuto: null,
    qaFlashDurationSeconds: null,
  };
}

export function formatClockFromSeconds(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function defaultQaPlanDraft(parentTotalSeconds: number): QaPlanDraft {
  const suggested = parentTotalSeconds > 0 ? Math.min(600, Math.max(60, Math.floor(parentTotalSeconds / 4))) : 600;
  return {
    label: 'Q&A',
    durationSeconds: suggested,
    startMode: 'end',
    startAtRemainingSeconds: suggested,
    autoStart: true,
    displayMode: 'sub',
  };
}

/**
 * Q&A sub-cue = parent cue + "Q" (CUE13 → CUE13Q, CUE 13 → CUE 13Q).
 * Prefer appending Q to the full parent string when it already looks like CUE## / CUE ##.
 */
export function qaCueFromParent(parentCueField?: string | null): string {
  const raw = String(parentCueField || '').trim();
  if (!raw) return '';
  if (/Q$/i.test(raw)) return raw;
  // Parent already looks like a cue label — keep spacing style and append Q.
  if (/^CUE\s*\d+/i.test(raw)) {
    return `${raw}Q`;
  }
  const numberMatch = raw.match(/(\d+)/);
  if (numberMatch) {
    return `CUE${numberMatch[1]}Q`;
  }
  const cleaned = raw.replace(/^CUE\s*/i, '').trim();
  if (!cleaned) return '';
  if (/Q$/i.test(cleaned)) return cleaned;
  return `${cleaned}Q`;
}
