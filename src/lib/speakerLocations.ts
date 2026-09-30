/** Speaker location roles used in Run of Show speaker slots. */
export const SPEAKER_LOCATIONS = ['Podium', 'Seat', 'Moderator', 'Virtual', 'Walking'] as const;

export type SpeakerLocation = (typeof SPEAKER_LOCATIONS)[number];

export function isSpeakerLocation(value: unknown): value is SpeakerLocation {
  return typeof value === 'string' && (SPEAKER_LOCATIONS as readonly string[]).includes(value);
}

export function normalizeSpeakerLocation(
  value: unknown,
  fallback: SpeakerLocation = 'Podium'
): SpeakerLocation {
  return isSpeakerLocation(value) ? value : fallback;
}

/** Compact schedule/report prefix: Podium→P, Seat→S, Virtual→V, Moderator→M, Walking→W. */
export function speakerLocationPrefix(location: string | null | undefined): string {
  if (location === 'Seat') return 'S';
  if (location === 'Virtual') return 'V';
  if (location === 'Moderator') return 'M';
  if (location === 'Walking') return 'W';
  return 'P';
}
