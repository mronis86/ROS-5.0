import { parseSpeakers, type ParsedSpeaker } from '../showcase/photoShowcaseHelpers';

export type MicType = 'none' | 'lav' | 'handheld' | 'lectern' | 'headset';

export const MIC_TYPE_OPTIONS: Array<{ value: MicType; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'lav', label: 'Lav' },
  { value: 'handheld', label: 'Handheld' },
  { value: 'lectern', label: 'Lectern/Podium' },
  { value: 'headset', label: 'Headset' },
];

export const MIC_UNIT_MAX = 12;

export type MicAssignment = {
  mic: MicType;
  /** Pack / unit number 1–12 for Lav, Handheld, Headset */
  unit: number | null;
};

export type MicAssignmentsState = {
  assignments: Record<string, MicAssignment>;
};

export function micAssignmentKey(itemId: number | string, slot: number): string {
  return `${itemId}:${slot}`;
}

export function micNeedsUnit(type: MicType | null | undefined): boolean {
  return type === 'lav' || type === 'handheld' || type === 'headset';
}

export function normalizeMicType(value: unknown): MicType {
  const v = String(value || '').toLowerCase();
  if (v === 'lav' || v === 'lavaliere' || v === 'lavalier') return 'lav';
  if (v === 'handheld' || v === 'hh' || v === 'hand held' || v === 'hand-held') return 'handheld';
  if (v === 'lectern' || v === 'podium' || v === 'lectern/podium') return 'lectern';
  if (v === 'headset' || v === 'hs') return 'headset';
  if (value && typeof value === 'object' && 'planned' in (value as object)) {
    return normalizeMicType((value as { planned?: unknown }).planned);
  }
  if (value && typeof value === 'object' && 'mic' in (value as object)) {
    return normalizeMicType((value as { mic?: unknown }).mic);
  }
  return 'none';
}

export function normalizeMicUnit(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > MIC_UNIT_MAX) return null;
  return Math.floor(n);
}

export function micTypeLabel(type: MicType | null | undefined): string {
  if (!type || type === 'none') return 'None';
  return MIC_TYPE_OPTIONS.find((o) => o.value === type)?.label || type;
}

/** Display label for a saved/resolved assignment (e.g. Handheld #3). */
export function formatMicAssignmentLabel(assignment: MicAssignment): string {
  if (!assignment.mic || assignment.mic === 'none') return 'None';
  const label = micTypeLabel(assignment.mic);
  if (!micNeedsUnit(assignment.mic)) return label;
  if (assignment.unit == null) return `${label} #?`;
  return `${label} #${assignment.unit}`;
}

export function isPodiumLocation(location?: string | null): boolean {
  return String(location || '').trim().toLowerCase() === 'podium';
}

/** Default mic for a speaker based on ROS location role. */
export function defaultMicForSpeakerLocation(location?: string | null): MicType {
  if (isPodiumLocation(location)) return 'lectern';
  return 'none';
}

export function getMicAssignment(
  assignments: Record<string, MicAssignment | Record<string, unknown> | MicType>,
  itemId: number | string,
  slot: number
): MicAssignment {
  const existing = assignments[micAssignmentKey(itemId, slot)];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    const mic = normalizeMicType(existing);
    const unitRaw = (existing as { unit?: unknown }).unit;
    return {
      mic,
      unit: micNeedsUnit(mic) ? normalizeMicUnit(unitRaw) : null,
    };
  }
  return { mic: normalizeMicType(existing), unit: null };
}

/**
 * Resolve display assignment: saved value, or Lectern/Podium when location is Podium
 * and nothing has been saved yet.
 */
export function resolveMicAssignment(
  assignments: Record<string, MicAssignment | Record<string, unknown> | MicType>,
  itemId: number | string,
  slot: number,
  location?: string | null
): MicAssignment {
  const key = micAssignmentKey(itemId, slot);
  const hasSaved = Object.prototype.hasOwnProperty.call(assignments, key);
  if (hasSaved) return getMicAssignment(assignments, itemId, slot);
  const mic = defaultMicForSpeakerLocation(location);
  return { mic, unit: null };
}

export function speakersForSlots(speakersText?: string): Array<ParsedSpeaker | null> {
  const speakers = parseSpeakers(speakersText);
  return [1, 2, 3, 4, 5, 6, 7].map((slot) => speakers.find((s) => s.slot === slot) || null);
}

export function speakersWithNames(speakersText?: string): ParsedSpeaker[] {
  return parseSpeakers(speakersText).filter((s) => Boolean(s.fullName?.trim() || s.photoLink));
}

export function parseMicAssignmentsPayload(raw: unknown): MicAssignmentsState {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const assignmentsRaw =
    data.assignments && typeof data.assignments === 'object'
      ? (data.assignments as Record<string, unknown>)
      : (data as Record<string, unknown>);

  const assignments: Record<string, MicAssignment> = {};
  for (const [key, value] of Object.entries(assignmentsRaw)) {
    if (key === 'assignments' || key === 'changes') continue;
    if (!key.includes(':')) continue;
    const mic = normalizeMicType(value);
    const unitRaw =
      value && typeof value === 'object' ? (value as { unit?: unknown }).unit : null;
    assignments[key] = {
      mic,
      unit: micNeedsUnit(mic) ? normalizeMicUnit(unitRaw) : null,
    };
  }
  return { assignments };
}

/** Seed Lectern/Podium for Podium speakers that have no saved assignment yet. */
export function seedPodiumAssignments(
  scheduleItems: Array<{ id: number; speakersText?: string }>,
  assignments: Record<string, MicAssignment>
): { assignments: Record<string, MicAssignment>; changed: boolean } {
  const next = { ...assignments };
  let changed = false;
  for (const item of scheduleItems) {
    for (const speaker of speakersWithNames(item.speakersText)) {
      if (!isPodiumLocation(speaker.location)) continue;
      const key = micAssignmentKey(item.id, speaker.slot);
      if (Object.prototype.hasOwnProperty.call(next, key)) continue;
      next[key] = { mic: 'lectern', unit: null };
      changed = true;
    }
  }
  return { assignments: next, changed };
}
