/** Speaker location roles used in Run of Show speaker slots. */
export const SPEAKER_LOCATIONS = ['Podium', 'Seat', 'Moderator', 'Virtual', 'Ted-Talk'] as const;

export type SpeakerLocation = (typeof SPEAKER_LOCATIONS)[number];

/** Legacy location renamed to Ted-Talk — still accepted on read. */
const LEGACY_WALKING_LOCATION = 'Walking';

export function isSpeakerLocation(value: unknown): value is SpeakerLocation {
  return typeof value === 'string' && (SPEAKER_LOCATIONS as readonly string[]).includes(value);
}

export function normalizeSpeakerLocation(
  value: unknown,
  fallback: SpeakerLocation = 'Podium'
): SpeakerLocation {
  if (typeof value === 'string' && value.trim() === LEGACY_WALKING_LOCATION) {
    return 'Ted-Talk';
  }
  return isSpeakerLocation(value) ? value : fallback;
}

/** Compact schedule/report prefix: Podium→P, Seat→S, Virtual→V, Moderator→M, Ted-Talk→T. */
export function speakerLocationPrefix(location: string | null | undefined): string {
  if (location === 'Seat') return 'S';
  if (location === 'Virtual') return 'V';
  if (location === 'Moderator') return 'M';
  if (location === 'Ted-Talk' || location === LEGACY_WALKING_LOCATION) return 'T';
  return 'P';
}
