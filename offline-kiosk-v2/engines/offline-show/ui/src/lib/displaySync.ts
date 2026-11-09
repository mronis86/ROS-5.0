/** Client-side helpers for per-event display/follower sync (schedule_data.displaySyncEnabled). */

export function parseDisplaySyncEnabled(
  scheduleData?: Record<string, unknown> | null
): boolean {
  if (!scheduleData || typeof scheduleData !== 'object') return true;
  return scheduleData.displaySyncEnabled !== false;
}

export const DISPLAY_SYNC_PAUSED_MESSAGE =
  'Display sync is paused for this event. An admin can re-enable it from the Event List.';

export const DISPLAY_SYNC_COLUMN_LABEL = 'Displays';
