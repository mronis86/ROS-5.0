/**
 * Suggest shot type from speaker list when admin auto-shot is enabled.
 *
 * Rules:
 * - Manual override → leave shot type unchanged
 * - No named speakers → leave shot type unchanged
 * - Program type is Podium / Podium Transition → "Podium"
 * - Otherwise → "N-Shot" from named speaker count (capped 1–7)
 *
 * Per-cue `shotTypeManualOverride` skips auto updates until the shot type is cleared.
 * New speakers default to Seat unless that program type is Podium.
 */

export type SpeakerForShotType = {
  fullName?: string | null;
  location?: string | null;
};

export function isPodiumProgramType(programType?: string | null): boolean {
  const t = String(programType || '').trim().toLowerCase();
  return t === 'podium' || t === 'podium transition';
}

/** New speaker slot: Seat, unless this cue's program type is Podium. */
export function defaultSpeakerLocationForProgram(
  programType?: string | null
): 'Podium' | 'Seat' {
  return isPodiumProgramType(programType) ? 'Podium' : 'Seat';
}

export function parseSpeakersForShotType(raw: unknown): SpeakerForShotType[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isPodiumSpeakerLocation(location?: string | null): boolean {
  return String(location || '').trim().toLowerCase() === 'podium';
}

export function suggestShotTypeFromSpeakers(
  speakers: SpeakerForShotType[] | null | undefined,
  opts?: { programType?: string | null }
): string | null {
  const named = (speakers || []).filter((s) => String(s.fullName || '').trim() !== '');
  if (named.length === 0) return null;

  if (isPodiumProgramType(opts?.programType)) {
    return 'Podium';
  }

  const n = Math.min(7, Math.max(1, named.length));
  return `${n}-Shot`;
}

/** Patch fields when applying (or skipping) auto shot type on speaker save. */
export function shotTypePatchFromSpeakers(
  speakers: SpeakerForShotType[] | null | undefined,
  opts?: { manualOverride?: boolean; programType?: string | null }
): { shotType: string } | Record<string, never> {
  if (opts?.manualOverride) return {};
  const suggested = suggestShotTypeFromSpeakers(speakers, { programType: opts?.programType });
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
