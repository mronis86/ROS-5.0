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
 * Gate Q&A auto-start on a real running parent countdown that has known duration.
 *
 * Rejects:
 * - parent not actively counting (caller must pass is_running / ticking, not merely LOADED)
 * - unknown / zero total (incl. hybrid progress still {0,0} on LOAD)
 * - remaining === total (LOAD or just-STARTED — never auto-start at full duration)
 * - remaining above the configured threshold
 * - elapsed < 1s (blocks the START tick before the clock has moved)
 */
export function shouldAutoStartQa(opts: {
  /** Must mean the parent timer is actively counting down (is_running), not merely loaded/active. */
  parentRunning: boolean;
  parentRemainingSeconds: number | null | undefined;
  parentTotalSeconds: number | null | undefined;
  thresholdSeconds: number | null | undefined;
  /** Optional explicit elapsed; otherwise derived as total - remaining. */
  parentElapsedSeconds?: number | null | undefined;
}): boolean {
  if (!opts.parentRunning) return false;
  const total = Number(opts.parentTotalSeconds);
  const remaining = Number(opts.parentRemainingSeconds);
  const threshold = Number(opts.thresholdSeconds);
  if (!Number.isFinite(total) || total <= 0) return false;
  if (!Number.isFinite(remaining)) return false;
  if (!Number.isFinite(threshold) || threshold < 0) return false;
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
 * Flash reminder: parent RUNNING and remaining <= threshold (until parent stops / remaining ≤ 0).
 * Same gate as auto-start so LOAD/START at full duration never flashes early.
 */
export function shouldShowQaFlashReminder(opts: {
  parentRunning: boolean;
  parentRemainingSeconds: number | null | undefined;
  parentTotalSeconds: number | null | undefined;
  thresholdSeconds: number | null | undefined;
  parentElapsedSeconds?: number | null | undefined;
}): boolean {
  const remaining = Number(opts.parentRemainingSeconds);
  if (Number.isFinite(remaining) && remaining <= 0) return false;
  return shouldAutoStartQa(opts);
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
