/** Cue-level REC flag is for planned post content — not “this show records.” */

export function itemNeedsRecording(item: { needsRecording?: boolean } | null | undefined): boolean {
  return item?.needsRecording === true;
}

export const CUE_RECORDING_MARK_WARNING =
  'Please only mark Record if you need this segment flagged for planned post content.\n\nDo not mark every segment. Show recording is already indicated by the event’s Record setting.';

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
