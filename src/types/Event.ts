/** Per-day room map (day number 1..N → location). Day 1 mirrors `location`. */
export type DayLocations = Record<number, string>;

/** Free-text venue notes when a day uses External/Off-Site. */
export type DayLocationDetails = Record<number, string>;

export const OFF_SITE_LOCATION = 'External/Off-Site';

export type WorkspaceMode = 'ros' | 'board';

/** RTMP / key / watch URL for events marked Streaming or Stream+Rec. */
export type EventStreamDetails = {
  rtmpUrl?: string;
  streamKey?: string;
  playbackUrl?: string;
  /** From public Stream Request form */
  youtubeChannel?: string;
  youtubeChannelOther?: string;
  /** YouTube video title */
  youtubeVideoTitle?: string;
  /** YouTube video description */
  youtubeDescription?: string;
  /** YouTube visibility: Public | Unlisted */
  visibility?: 'Public' | 'Unlisted' | string;
  /** Who should get the player link (Swoogo / posting). */
  shareWith?: string;
  requestContactName?: string;
  requestContactEmail?: string;
  requestSubmittedAt?: string;
};

export const STREAM_YOUTUBE_CHANNEL_OPTIONS = [
  'US Chamber of Commerce',
  'USCC Foundation',
  'Hiring Our Heroes',
  'CO',
  'Other',
] as const;

export const STREAM_VISIBILITY_OPTIONS = ['Public', 'Unlisted'] as const;

export function eventHasStreamRequestInfo(details?: EventStreamDetails | null): boolean {
  if (!details) return false;
  return !!(
    String(details.youtubeChannel || '').trim() ||
    String(details.youtubeVideoTitle || '').trim() ||
    String(details.youtubeDescription || '').trim() ||
    String(details.visibility || '').trim() ||
    String(details.shareWith || '').trim() ||
    String(details.requestSubmittedAt || '').trim()
  );
}

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
  /**
   * Ingest / playback info when Broadcast Options is Streaming or Stream+Rec.
   * Stream key is sensitive — do not put in public ICS / guest exports.
   */
  streamDetails?: EventStreamDetails;
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
  streamDetails?: EventStreamDetails;
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

export function eventNeedsStreamDetails(recordStreaming?: string | null): boolean {
  const v = String(recordStreaming || '').trim();
  return v === 'Streaming' || v === 'Stream+Rec';
}

export function parseEventStreamDetails(raw: unknown): EventStreamDetails | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const rtmpUrl = typeof o.rtmpUrl === 'string' ? o.rtmpUrl : '';
  const streamKey = typeof o.streamKey === 'string' ? o.streamKey : '';
  const playbackUrl = typeof o.playbackUrl === 'string' ? o.playbackUrl : '';
  const youtubeChannel = typeof o.youtubeChannel === 'string' ? o.youtubeChannel : '';
  const youtubeChannelOther = typeof o.youtubeChannelOther === 'string' ? o.youtubeChannelOther : '';
  const youtubeVideoTitle = typeof o.youtubeVideoTitle === 'string' ? o.youtubeVideoTitle : '';
  const youtubeDescription = typeof o.youtubeDescription === 'string' ? o.youtubeDescription : '';
  const visibility = typeof o.visibility === 'string' ? o.visibility : '';
  const shareWith = typeof o.shareWith === 'string' ? o.shareWith : '';
  const requestContactName = typeof o.requestContactName === 'string' ? o.requestContactName : '';
  const requestContactEmail = typeof o.requestContactEmail === 'string' ? o.requestContactEmail : '';
  const requestSubmittedAt = typeof o.requestSubmittedAt === 'string' ? o.requestSubmittedAt : '';
  if (
    !rtmpUrl &&
    !streamKey &&
    !playbackUrl &&
    !youtubeChannel &&
    !youtubeVideoTitle &&
    !youtubeDescription &&
    !visibility &&
    !shareWith &&
    !requestSubmittedAt
  ) {
    return undefined;
  }
  return {
    rtmpUrl,
    streamKey,
    playbackUrl,
    youtubeChannel,
    youtubeChannelOther,
    youtubeVideoTitle,
    youtubeDescription,
    visibility,
    shareWith,
    requestContactName,
    requestContactEmail,
    requestSubmittedAt,
  };
}

/** Keep details only when broadcast mode needs them; trim empty strings. */
export function normalizeEventStreamDetails(
  recordStreaming: string | null | undefined,
  details?: EventStreamDetails | null
): EventStreamDetails | undefined {
  if (!eventNeedsStreamDetails(recordStreaming)) return undefined;
  const rtmpUrl = String(details?.rtmpUrl || '').trim();
  const streamKey = String(details?.streamKey || '').trim();
  const playbackUrl = String(details?.playbackUrl || '').trim();
  const youtubeChannel = String(details?.youtubeChannel || '').trim();
  const youtubeChannelOther = String(details?.youtubeChannelOther || '').trim();
  const youtubeVideoTitle = String(details?.youtubeVideoTitle || '').trim();
  const youtubeDescription = String(details?.youtubeDescription || '').trim();
  const visibility = String(details?.visibility || '').trim();
  const shareWith = String(details?.shareWith || '').trim();
  const requestContactName = String(details?.requestContactName || '').trim();
  const requestContactEmail = String(details?.requestContactEmail || '').trim();
  const requestSubmittedAt = String(details?.requestSubmittedAt || '').trim();
  if (
    !rtmpUrl &&
    !streamKey &&
    !playbackUrl &&
    !youtubeChannel &&
    !youtubeVideoTitle &&
    !youtubeDescription &&
    !visibility &&
    !shareWith &&
    !requestSubmittedAt
  ) {
    return {};
  }
  return {
    rtmpUrl,
    streamKey,
    playbackUrl,
    youtubeChannel,
    youtubeChannelOther,
    youtubeVideoTitle,
    youtubeDescription,
    visibility,
    shareWith,
    requestContactName,
    requestContactEmail,
    requestSubmittedAt,
  };
}

/** Ready to go live when RTMP + key are both present (playback URL optional). */
export function eventStreamDetailsReady(details?: EventStreamDetails | null): boolean {
  return !!(String(details?.rtmpUrl || '').trim() && String(details?.streamKey || '').trim());
}

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
