/**
 * Timed markers: indented rows under a parent cue (like indented timers).
 * No duration — they do not advance the show timeline.
 *
 * Modes:
 * - absolute: fixed wall-clock time; does NOT slide with parent overtime
 * - offset: seconds after parent start; DOES slide with parent over/under
 */

export type TimedMarkerMode = 'absolute' | 'offset';

export type TimedMarkerFields = {
  isTimedMarker?: boolean;
  /** How this marker's start time is interpreted. Defaults to offset when missing. */
  markerTimeMode?: TimedMarkerMode;
  /** Seconds after the parent cue's start (offset mode). */
  markerOffsetSeconds?: number;
  /** Seconds since midnight (absolute mode). */
  markerAbsoluteSeconds?: number;
};

export function isTimedMarkerItem(item: TimedMarkerFields | null | undefined): boolean {
  return item?.isTimedMarker === true;
}

export function normalizeMarkerTimeMode(raw: unknown): TimedMarkerMode {
  return raw === 'absolute' ? 'absolute' : 'offset';
}

/** Parse "7:20 AM", "07:20", "19:20" → seconds since midnight, or null. */
export function parseClockToSeconds(raw: string): number | null {
  // Normalize NNBSP / thin spaces from toLocaleTimeString on some OSes
  const s = String(raw || '')
    .replace(/[\u00a0\u202f\u2007\u2009]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;

  const ampm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    const sec = ampm[3] ? parseInt(ampm[3], 10) : 0;
    const ap = ampm[4].toUpperCase();
    if (!Number.isFinite(h) || !Number.isFinite(m) || m > 59 || sec > 59) return null;
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    if (h > 23) return null;
    return h * 3600 + m * 60 + sec;
  }

  const mil = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (mil) {
    const h = parseInt(mil[1], 10);
    const m = parseInt(mil[2], 10);
    const sec = mil[3] ? parseInt(mil[3], 10) : 0;
    if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59 || sec > 59) return null;
    return h * 3600 + m * 60 + sec;
  }

  return null;
}

/** "7:00 AM" / "07:00" → seconds since midnight. */
export function displayTimeToSeconds(display: string): number | null {
  return parseClockToSeconds(display);
}

export function secondsToDisplayTime(totalSeconds: number): string {
  const daySec = ((Math.floor(totalSeconds) % 86400) + 86400) % 86400;
  const h = Math.floor(daySec / 3600);
  const m = Math.floor((daySec % 3600) / 60);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function secondsToHHMM(totalSeconds: number): string {
  const daySec = ((Math.floor(totalSeconds) % 86400) + 86400) % 86400;
  const h = Math.floor(daySec / 3600);
  const m = Math.floor((daySec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Convert an absolute clock entry into offset seconds from the parent start display.
 * Returns null if either time cannot be parsed.
 */
export function absoluteTimeToOffsetSeconds(
  parentStartDisplay: string,
  absoluteRaw: string
): number | null {
  const parentSec = displayTimeToSeconds(parentStartDisplay);
  const absSec = parseClockToSeconds(absoluteRaw);
  if (parentSec == null || absSec == null) return null;
  let offset = absSec - parentSec;
  // Cross midnight: if absolute is "before" parent by a lot, assume next day
  if (offset < -12 * 3600) offset += 86400;
  return offset;
}

export function applyOffsetToDisplayTime(
  parentStartDisplay: string,
  offsetSeconds: number
): string {
  const parentSec = displayTimeToSeconds(parentStartDisplay);
  if (parentSec == null) return '';
  return secondsToDisplayTime(parentSec + (Number(offsetSeconds) || 0));
}

export function normalizeMarkerOffsetSeconds(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 48 * 3600);
}

export function normalizeMarkerAbsoluteSeconds(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 0;
  return ((n % 86400) + 86400) % 86400;
}

/**
 * Resolve the display start time for a timed marker.
 * - absolute: fixed wall clock (ignores parent overtime)
 * - offset: parentStart + offset (pass overtime-adjusted parent when in-show)
 */
export function resolveTimedMarkerDisplayTime(
  item: TimedMarkerFields,
  parentStartDisplay: string
): string {
  const mode = normalizeMarkerTimeMode(item.markerTimeMode);
  if (mode === 'absolute') {
    // Prefer stored absolute seconds; fall back to parsing a legacy offset display
    if (item.markerAbsoluteSeconds != null && Number.isFinite(Number(item.markerAbsoluteSeconds))) {
      return secondsToDisplayTime(normalizeMarkerAbsoluteSeconds(item.markerAbsoluteSeconds));
    }
    // Legacy rows only had offset — show against parent once, but treat as absolute if mode set
    if (parentStartDisplay) {
      return applyOffsetToDisplayTime(
        parentStartDisplay,
        normalizeMarkerOffsetSeconds(item.markerOffsetSeconds)
      );
    }
    return '';
  }
  if (!parentStartDisplay) return '';
  return applyOffsetToDisplayTime(
    parentStartDisplay,
    normalizeMarkerOffsetSeconds(item.markerOffsetSeconds)
  );
}

/** Fields to persist on a schedule item for a timed marker. */
export function timedMarkerPersistFields(item: TimedMarkerFields): TimedMarkerFields {
  const mode = normalizeMarkerTimeMode(item.markerTimeMode);
  if (mode === 'absolute') {
    return {
      isTimedMarker: true,
      markerTimeMode: 'absolute',
      markerAbsoluteSeconds: normalizeMarkerAbsoluteSeconds(item.markerAbsoluteSeconds),
      markerOffsetSeconds: 0,
    };
  }
  return {
    isTimedMarker: true,
    markerTimeMode: 'offset',
    markerOffsetSeconds: normalizeMarkerOffsetSeconds(item.markerOffsetSeconds),
    markerAbsoluteSeconds: undefined,
  };
}
