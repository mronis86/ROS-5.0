/** Planned Q&A indented sub-cue under a parent ROS row. */

export type QaStartMode = 'end' | 'remaining';

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
