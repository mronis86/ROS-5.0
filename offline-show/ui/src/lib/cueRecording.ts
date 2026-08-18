/** Cue-level recording flag stored on schedule_items JSON. */

export function itemNeedsRecording(item: { needsRecording?: boolean } | null | undefined): boolean {
  return item?.needsRecording === true;
}
