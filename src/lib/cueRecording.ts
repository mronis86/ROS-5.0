/** Cue-level REC flag is for planned post content — not “this show records.” */

export type CueRecordingSource = 'comms' | 'ros';

export function itemNeedsRecording(item: { needsRecording?: boolean } | null | undefined): boolean {
  return item?.needsRecording === true;
}

/** True when Comms (page or Comms user) marked this cue — ASAP / Comms request. */
export function itemMarkedByComms(item: {
  needsRecording?: boolean;
  recordingSource?: string | null;
} | null | undefined): boolean {
  return itemNeedsRecording(item) && String(item?.recordingSource || '').toLowerCase() === 'comms';
}

export function resolveRecordingSource(
  needsRecording: boolean,
  opts?: { fromComms?: boolean; isCommsUser?: boolean; previous?: string | null }
): CueRecordingSource | null {
  if (!needsRecording) return null;
  if (opts?.fromComms || opts?.isCommsUser) return 'comms';
  if (String(opts?.previous || '').toLowerCase() === 'comms') return 'comms';
  return 'ros';
}

export function recordingUpdatedAtMs(item: { recordingUpdatedAt?: unknown; recording_updated_at?: unknown } | null | undefined): number {
  const n = Number(item?.recordingUpdatedAt ?? item?.recording_updated_at ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Keep the newer REC stamp so a stale row save cannot undo a dedicated recording PATCH. */
export function mergeNewerRecordingFlags<T extends Record<string, any>>(incoming: T, existing: T | null | undefined): T {
  if (!existing) return incoming;
  if (recordingUpdatedAtMs(existing) > recordingUpdatedAtMs(incoming)) {
    return {
      ...incoming,
      needsRecording: existing.needsRecording === true,
      recordingSource: existing.recordingSource ?? existing.recording_source ?? null,
      recordingUpdatedAt: recordingUpdatedAtMs(existing),
    };
  }
  return incoming;
}

/** Short header for custom REC hover tooltips. */
export const CUE_RECORDING_HOVER_TITLE = 'For post / social export';

/** Body for custom REC hover tooltips (keep readable on a large tip). */
export const CUE_RECORDING_HOVER_BODY =
  'Does not change your master record for the full program.';

export const CUE_RECORDING_MARK_WARNING =
  'Mark only cues needed for post or social export.\n\nDoes not change your master record for the full program.';

export function shouldConfirmCueRecordingMark(
  user: { is_admin?: boolean; is_comms?: boolean } | null | undefined
): boolean {
  if (!user) return true;
  // Comms / Admin routinely mark cues for post content — skip the nag.
  if (user.is_admin === true || user.is_comms === true) return false;
  return true;
}

/** Returns false if the user cancelled. */
export function confirmCueRecordingMarkIfNeeded(
  user: { is_admin?: boolean; is_comms?: boolean } | null | undefined
): boolean {
  if (!shouldConfirmCueRecordingMark(user)) return true;
  return window.confirm(CUE_RECORDING_MARK_WARNING);
}
