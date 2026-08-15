/** Default Pre-Flight / Show Checklist template (sections + items). */

export const PREFLIGHT_SECTIONS = ['Lighting', 'Audio', 'Broadcast', 'Media Playback'] as const;

export type PreflightSection = (typeof PREFLIGHT_SECTIONS)[number];

export type PreflightTemplateItem = {
  section: PreflightSection;
  label: string;
};

/** Generic crew template — event-specific rows can be added later per show. */
export const PREFLIGHT_DEFAULT_TEMPLATE: PreflightTemplateItem[] = [
  { section: 'Lighting', label: 'House lights preset confirmed' },
  { section: 'Lighting', label: 'Stage wash / specials verified' },
  { section: 'Lighting', label: 'Cue look matches show caller brief' },
  { section: 'Lighting', label: 'Backup / emergency lighting path known' },
  { section: 'Lighting', label: 'Followspot / movers (if used) checked' },

  { section: 'Audio', label: 'Room PA on and level-checked' },
  { section: 'Audio', label: 'Mics labeled (handheld / lav / podium)' },
  { section: 'Audio', label: 'RF scan / batteries confirmed' },
  { section: 'Audio', label: 'Speaker walk-on / walk-off music path tested' },
  { section: 'Audio', label: 'Comms / IFB (if used) verified' },

  { section: 'Broadcast', label: 'Program audio feed clean' },
  { section: 'Broadcast', label: 'Record / stream path armed' },
  { section: 'Broadcast', label: 'Levels / meters checked (no clip, not too quiet)' },
  { section: 'Broadcast', label: 'Camera / ISO / framing (if applicable) confirmed' },
  { section: 'Broadcast', label: 'Lower thirds / CG source linked and updating' },

  { section: 'Media Playback', label: 'Playback machine / playlist armed' },
  { section: 'Media Playback', label: 'Videos / decks on correct machine and output' },
  { section: 'Media Playback', label: 'Resolume / Mitti / Companion path tested (if used)' },
  { section: 'Media Playback', label: 'Confidence monitor shows correct content' },
  { section: 'Media Playback', label: 'Backup media / spare drive available' },
];

export type PreflightChecklistItem = {
  id: string;
  event_id: string;
  day?: number;
  section: string;
  label: string;
  sort_order: number;
  is_custom: boolean;
  is_checked: boolean;
  checked_by_user_id?: string | null;
  checked_by_name?: string | null;
  checked_at?: string | null;
  note?: string | null;
};

export function summarizePreflightProgress(items: PreflightChecklistItem[]): {
  total: number;
  checked: number;
  complete: boolean;
} {
  const total = items.length;
  const checked = items.filter((i) => i.is_checked).length;
  return { total, checked, complete: total > 0 && checked === total };
}

/** True if local calendar day falls in [eventDate, eventDate + numberOfDays - 1]. */
export function isEventShowDay(
  eventDate?: string | null,
  numberOfDays = 1,
  now: Date = new Date()
): boolean {
  return getEventDayNumberForDate(eventDate, numberOfDays, now) != null;
}

/**
 * Which show day (1-based) "today" is for this event, or null if outside the run.
 */
export function getEventDayNumberForDate(
  eventDate?: string | null,
  numberOfDays = 1,
  now: Date = new Date()
): number | null {
  if (!eventDate) return null;
  const start = new Date(`${String(eventDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const days = Math.max(1, Math.floor(Number(numberOfDays) || 1));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = today.getTime() - start.getTime();
  const dayIndex = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (dayIndex < 0 || dayIndex >= days) return null;
  return dayIndex + 1;
}
