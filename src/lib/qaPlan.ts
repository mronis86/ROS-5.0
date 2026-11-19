/** Planned Q&A timer row under a parent ROS cue (marker-style, not a Sub Cue / ALT). */

export type QaStartMode = 'end' | 'remaining';

export function isQaPlanRow(item: { qaIsAutoQa?: boolean } | null | undefined): boolean {
  return item?.qaIsAutoQa === true;
}

export type QaPlanDraft = {
  label: string;
  /** Q&A length in seconds. */
  durationSeconds: number;
  startMode: QaStartMode;
  /**
   * When startMode === 'remaining': start Q&A when parent remaining reaches this.
   * Ignored for 'end' (uses durationSeconds as the remaining threshold).
   */
  startAtRemainingSeconds: number;
  autoStart: boolean;
};

export type QaPlanModalResult = QaPlanDraft & {
  /** Effective remaining threshold used for auto-start. */
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
 * Rejects the common false-positive where hybrid progress is still {0,0} on parent LOAD/START
 * (remaining would compute as 0 and trip any threshold immediately).
 */
export function shouldAutoStartQa(opts: {
  parentRunning: boolean;
  parentRemainingSeconds: number | null | undefined;
  parentTotalSeconds: number | null | undefined;
  thresholdSeconds: number | null | undefined;
}): boolean {
  if (!opts.parentRunning) return false;
  const total = Number(opts.parentTotalSeconds);
  const remaining = Number(opts.parentRemainingSeconds);
  const threshold = Number(opts.thresholdSeconds);
  if (!Number.isFinite(total) || total <= 0) return false;
  if (!Number.isFinite(remaining)) return false;
  if (!Number.isFinite(threshold) || threshold < 0) return false;
  return remaining <= threshold;
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
