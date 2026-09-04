/** Per-day room map (day number 1..N → location). Day 1 mirrors `location`. */
export type DayLocations = Record<number, string>;

/** Free-text venue notes when a day uses External/Off-Site. */
export type DayLocationDetails = Record<number, string>;

export const OFF_SITE_LOCATION = 'External/Off-Site';

export type WorkspaceMode = 'ros' | 'board';

/** Event types that may choose Event Board instead of a timed ROS. */
export const BOARD_ELIGIBLE_EVENT_TYPES = new Set(['General Meeting', 'Hollow Square']);

export function eventAllowsBoardChoice(eventType?: string | null): boolean {
  return BOARD_ELIGIBLE_EVENT_TYPES.has(String(eventType || '').trim());
}

export function normalizeWorkspaceMode(
  mode: unknown,
  eventType?: string | null
): WorkspaceMode {
  if (String(mode || '').trim() === 'board' && eventAllowsBoardChoice(eventType)) {
    return 'board';
  }
  return 'ros';
}

export function isOffSiteLocation(location: string | null | undefined): boolean {
  return (location || '').trim() === OFF_SITE_LOCATION;
}

export interface Event {
  id: string;
  name: string;
  date: string; // ISO date string
  location: string;
  /** When set and days differ, Event List shows each day's room. */
  dayLocations?: DayLocations;
  /** Off-site venue text for day 1 / primary location. */
  locationDetail?: string;
  /** Per-day off-site venue text (day 1 mirrors `locationDetail`). */
  dayLocationDetails?: DayLocationDetails;
  numberOfDays: number;
  timezone?: string; // Event timezone
  eventType?: string;
  recordStreaming?: string;
  /** Timed ROS (default) or Event Board workspace. */
  workspaceMode?: WorkspaceMode;
  created_at?: string;
  updated_at?: string;
  /** Hidden backend row for Quick Mode timers — shown on Quick Mode tab */
  isQuickMode?: boolean;
  calendarId?: string;
  /** When false, follower pages (Green Room, Photo, etc.) stop syncing. Default true. */
  displaySyncEnabled?: boolean;
}

export interface EventFormData {
  name: string;
  date: string;
  location: string;
  dayLocations?: DayLocations;
  locationDetail?: string;
  dayLocationDetails?: DayLocationDetails;
  numberOfDays: number;
  timezone?: string;
  eventType?: string;
  recordStreaming?: string;
  workspaceMode?: WorkspaceMode;
}

export function parseDayLocations(raw: unknown): DayLocations | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: DayLocations = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const day = Number(key);
    if (!Number.isInteger(day) || day < 1 || typeof value !== 'string' || !value.trim()) continue;
    out[day] = value.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

export function parseDayLocationDetails(raw: unknown): DayLocationDetails | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: DayLocationDetails = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const day = Number(key);
    if (!Number.isInteger(day) || day < 1 || typeof value !== 'string' || !value.trim()) continue;
    out[day] = value.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/** Fill every day 1..numberOfDays; missing days inherit primary `location`. */
export function normalizeDayLocations(
  location: string,
  numberOfDays: number,
  dayLocations?: DayLocations | null
): DayLocations {
  const days = Math.max(1, Number(numberOfDays) || 1);
  const primary = (location || 'Great Hall').trim() || 'Great Hall';
  const result: DayLocations = {};
  for (let day = 1; day <= days; day++) {
    const fromMap = dayLocations?.[day];
    result[day] = (typeof fromMap === 'string' && fromMap.trim()) || primary;
  }
  return result;
}

/**
 * Keep off-site detail only for days whose location is External/Off-Site.
 * Day 1 detail also mirrors `locationDetail` when provided.
 */
export function normalizeDayLocationDetails(
  location: string,
  numberOfDays: number,
  dayLocations?: DayLocations | null,
  locationDetail?: string | null,
  dayLocationDetails?: DayLocationDetails | null
): DayLocationDetails {
  const locs = normalizeDayLocations(location, numberOfDays, dayLocations);
  const days = Math.max(1, Number(numberOfDays) || 1);
  const result: DayLocationDetails = {};
  for (let day = 1; day <= days; day++) {
    if (!isOffSiteLocation(locs[day])) continue;
    const fromMap = dayLocationDetails?.[day];
    const fromPrimary = day === 1 ? locationDetail : undefined;
    const value = (typeof fromMap === 'string' && fromMap.trim())
      || (typeof fromPrimary === 'string' && fromPrimary.trim())
      || '';
    if (value) result[day] = value;
  }
  return result;
}

export function formatLocationLabel(
  location: string,
  detail?: string | null
): string {
  const loc = (location || '').trim() || 'Great Hall';
  const info = (detail || '').trim();
  if (isOffSiteLocation(loc) && info) return `${loc} — ${info}`;
  return loc;
}

export function eventUsesMultipleLocations(event: {
  location: string;
  numberOfDays: number;
  dayLocations?: DayLocations;
}): boolean {
  if ((event.numberOfDays || 1) <= 1) return false;
  const locs = normalizeDayLocations(event.location, event.numberOfDays, event.dayLocations);
  const values = Object.values(locs);
  return new Set(values).size > 1;
}

export function eventMatchesLocationFilter(
  event: { location: string; numberOfDays: number; dayLocations?: DayLocations },
  filterLocation: string
): boolean {
  if (filterLocation === 'all') return true;
  const locs = normalizeDayLocations(event.location, event.numberOfDays, event.dayLocations);
  return Object.values(locs).includes(filterLocation);
}

export function eventLocationSearchText(event: {
  location: string;
  numberOfDays: number;
  dayLocations?: DayLocations;
  locationDetail?: string;
  dayLocationDetails?: DayLocationDetails;
}): string {
  const locs = normalizeDayLocations(event.location, event.numberOfDays, event.dayLocations);
  const details = normalizeDayLocationDetails(
    event.location,
    event.numberOfDays,
    event.dayLocations,
    event.locationDetail,
    event.dayLocationDetails
  );
  const parts = Object.entries(locs).map(([day, loc]) =>
    formatLocationLabel(loc, details[Number(day)])
  );
  return parts.join(' ');
}

export const EVENT_TYPE_OPTIONS = [
  { value: 'Staged Production', label: 'Staged Production', color: 'bg-amber-500' },
  { value: 'Studio Hit', label: 'Studio Hit', color: 'bg-cyan-500' },
  { value: 'General Meeting', label: 'General Meeting', color: 'bg-emerald-500' },
  { value: 'Hollow Square', label: 'Hollow Square', color: 'bg-violet-500' },
];

export const RECORD_STREAMING_OPTIONS = [
  { value: 'Record', label: 'Record', color: 'bg-red-500' },
  { value: 'Streaming', label: 'Streaming', color: 'bg-green-700' },
  { value: 'Stream+Rec', label: 'Stream+Rec', color: 'bg-violet-600' },
  { value: 'None', label: 'None', color: 'bg-slate-500' },
];

export const LOCATION_OPTIONS = [
  { value: 'Great Hall', label: 'Great Hall', color: 'bg-blue-600' },
  { value: 'Briefing Center', label: 'Briefing Center', color: 'bg-green-600' },
  { value: 'Lee Anderson', label: 'Lee Anderson', color: 'bg-purple-600' },
  { value: 'MR1', label: 'MR1', color: 'bg-indigo-600' },
  { value: 'MR2', label: 'MR2', color: 'bg-indigo-600' },
  { value: 'MR3', label: 'MR3', color: 'bg-indigo-600' },
  { value: 'MR4', label: 'MR4', color: 'bg-indigo-600' },
  { value: 'MR3+4', label: 'MR3+4', color: 'bg-indigo-600' },
  { value: 'Media Room', label: 'Media Room', color: 'bg-teal-600' },
  { value: 'Studio Floor 4', label: 'Studio Floor 4', color: 'bg-sky-600' },
  { value: OFF_SITE_LOCATION, label: 'External/Off-Site', color: 'bg-rose-600' },
  { value: 'Virtual', label: 'Virtual', color: 'bg-orange-600' },
];

export const DAYS_OPTIONS = [1, 2, 3, 4, 5];

export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (EST/EDT)' },
  { value: 'America/Chicago', label: 'Central (CST/CDT)' },
  { value: 'America/Denver', label: 'Mountain (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PST/PDT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKST/AKDT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' }
];
