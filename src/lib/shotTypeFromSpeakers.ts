/**
 * Suggest shot type from speaker list when admin auto-shot is enabled.
 *
 * Rules:
 * - No named speakers → null (leave shot type unchanged)
 * - Exactly one named speaker with location Podium → "Podium"
 * - Otherwise → "N-Shot" where N = named speaker count (capped 1–7)
 *
 * Per-cue `shotTypeManualOverride` skips auto updates until the shot type is cleared.
 */

export type SpeakerForShotType = {
  fullName?: string | null;
  location?: string | null;
};

export function isPodiumSpeakerLocation(location?: string | null): boolean {
  return String(location || '').trim().toLowerCase() === 'podium';
}

export function suggestShotTypeFromSpeakers(
  speakers: SpeakerForShotType[] | null | undefined
): string | null {
  const named = (speakers || []).filter((s) => String(s.fullName || '').trim() !== '');
  if (named.length === 0) return null;

  if (named.length === 1 && isPodiumSpeakerLocation(named[0].location)) {
    return 'Podium';
  }

  const n = Math.min(7, Math.max(1, named.length));
  return `${n}-Shot`;
}

/** Patch fields when applying (or skipping) auto shot type on speaker save. */
export function shotTypePatchFromSpeakers(
  speakers: SpeakerForShotType[] | null | undefined,
  opts?: { manualOverride?: boolean }
): { shotType: string } | Record<string, never> {
  if (opts?.manualOverride) return {};
  const suggested = suggestShotTypeFromSpeakers(speakers);
  if (!suggested) return {};
  return { shotType: suggested };
}

/** Manual UI change: any non-empty value locks the cue; empty unlocks auto again. */
export function shotTypeManualEditPatch(nextShotType: string): {
  shotType: string;
  shotTypeManualOverride: boolean;
} {
  const shotType = String(nextShotType || '');
  return {
    shotType,
    shotTypeManualOverride: shotType.trim() !== '',
  };
}
