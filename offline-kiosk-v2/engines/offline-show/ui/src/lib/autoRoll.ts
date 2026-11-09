import { isIndentedScheduleItem, type IndentedCueLookup } from './scheduleStartTime';

export const AUTO_ROLL_GRACE_MS = 2 * 60_000;

export type AutoRollArmed = {
  armed: true;
  armedAt: string;
  armedBy?: string | null;
  armedByName?: string | null;
};

export type AutoRollCueLike = {
  id: number;
  day?: number;
  programType?: string;
  segmentName?: string;
  customFields?: { cue?: string; [key: string]: unknown };
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
  isTimedMarker?: boolean;
  isIndented?: boolean;
};

export type AutoRollSlot = {
  item: AutoRollCueLike;
  index: number;
  startMs: number;
  startHHMM: string;
  startLabel: string;
};

export function parseAutoRoll(raw: unknown): AutoRollArmed | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.armed !== true) return null;
  return {
    armed: true,
    armedAt: String(o.armedAt || ''),
    armedBy: o.armedBy != null ? String(o.armedBy) : null,
    armedByName: o.armedByName != null ? String(o.armedByName) : null,
  };
}

export function autoRollStorageKey(eventId: string): string {
  return `rosAutoRoll:${eventId}`;
}

export function readStoredAutoRoll(eventId: string): AutoRollArmed | null {
  if (!eventId || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(autoRollStorageKey(eventId));
    if (!raw) return null;
    return parseAutoRoll(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeStoredAutoRoll(eventId: string, value: AutoRollArmed | null): void {
  if (!eventId || typeof localStorage === 'undefined') return;
  try {
    const key = autoRollStorageKey(eventId);
    if (!value) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota */
  }
}

/** Prefer the API when it is armed; otherwise keep the local copy so refresh still holds. */
export function resolveAutoRoll(apiValue: unknown, eventId: string): AutoRollArmed | null {
  const fromApi = parseAutoRoll(apiValue);
  if (fromApi) {
    writeStoredAutoRoll(eventId, fromApi);
    return fromApi;
  }
  return readStoredAutoRoll(eventId);
}

export function autoRollSettingsPatch(armed: AutoRollArmed | null): { auto_roll?: AutoRollArmed } {
  return armed ? { auto_roll: armed } : {};
}

export function itemDurationSeconds(item: AutoRollCueLike | undefined): number {
  if (!item) return 0;
  return (
    (Number(item.durationHours) || 0) * 3600 +
    (Number(item.durationMinutes) || 0) * 60 +
    (Number(item.durationSeconds) || 0)
  );
}

export function isAutoRollPlayable(
  item: AutoRollCueLike | undefined,
  indentedLookup?: IndentedCueLookup | null
): boolean {
  if (!item) return false;
  if (item.isTimedMarker) return false;
  if (isIndentedScheduleItem(item, indentedLookup || {})) return false;
  const programType = String(item.programType || '').trim();
  if (programType === 'Delay Block' || programType === 'Show Break' || programType === 'KILLED') return false;
  return itemDurationSeconds(item) > 0;
}

export function buildAutoRollSlots<T extends AutoRollCueLike>(opts: {
  schedule: T[];
  indentedLookup?: IndentedCueLookup | null;
  day?: number | null;
  skipItemId?: number | null;
  resolveStart: (item: T, index: number) => { startHHMM: string; startLabel: string; startMs: number } | null;
}): AutoRollSlot[] {
  const wantDay =
    opts.day != null && Number.isFinite(Number(opts.day)) ? Math.floor(Number(opts.day)) : null;
  const slots: AutoRollSlot[] = [];
  opts.schedule.forEach((item, index) => {
    if (wantDay != null && (item.day || 1) !== wantDay) return;
    if (!isAutoRollPlayable(item, opts.indentedLookup)) return;
    if (opts.skipItemId != null && Number(item.id) === Number(opts.skipItemId)) return;
    const start = opts.resolveStart(item, index);
    if (!start) return;
    slots.push({
      item,
      index,
      startMs: start.startMs,
      startHHMM: start.startHHMM,
      startLabel: start.startLabel,
    });
  });
  slots.sort((a, b) => a.startMs - b.startMs || a.index - b.index);
  return slots;
}

/** Latest slot whose start is at/before now. */
export function pickCurrentAutoRollSlot(
  slots: AutoRollSlot[],
  nowMs: number
): AutoRollSlot | null {
  let current: AutoRollSlot | null = null;
  for (const slot of slots) {
    if (slot.startMs <= nowMs) current = slot;
    else break;
  }
  return current;
}

export function pickNextAutoRollSlot(
  slots: AutoRollSlot[],
  nowMs: number
): AutoRollSlot | null {
  return slots.find((slot) => slot.startMs > nowMs) || null;
}

/**
 * Skip slots that were already in the past when Auto Roll was armed,
 * except the current slot if it started within the grace window.
 */
export function slotAllowedAfterArm(
  slot: AutoRollSlot,
  armedAtMs: number | null,
  nowMs: number,
  graceMs = AUTO_ROLL_GRACE_MS
): boolean {
  if (armedAtMs == null || !Number.isFinite(armedAtMs)) return true;
  if (slot.startMs >= armedAtMs - 1000) return true;
  if (slot.startMs <= nowMs && nowMs - slot.startMs <= graceMs) return true;
  return false;
}
