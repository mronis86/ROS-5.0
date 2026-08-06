import { isEventPast, isEventUpcoming, parseEventDateLocal, startOfTodayLocal } from './eventActiveWindow';
import { isQuickModeCalendarEvent } from './quickModeEvent';

export interface AccessEventCalendarRow {
  id: string;
  name: string;
  date: string;
  isQuickMode?: boolean;
  schedule_data?: Record<string, unknown> | null;
}

export type AccessEventListTab = 'upcoming' | 'past' | 'quickMode';

export interface AccessEventAccessUser {
  id: string;
  email: string;
  full_name?: string | null;
  is_admin?: boolean;
}

export type EventVisibilityMode = 'all' | 'restricted';

export interface EventAccessLoadResult {
  event_ids: string[];
  events: AccessEventCalendarRow[];
  needsMigration?: boolean;
  error?: string;
}

function accessEventNumberOfDays(event: AccessEventCalendarRow): number {
  const raw = event.schedule_data?.numberOfDays;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Normalize API rows so Quick Mode is detected even if the server omits isQuickMode. */
export function normalizeAccessEventRow(event: AccessEventCalendarRow): AccessEventCalendarRow {
  return {
    ...event,
    isQuickMode: event.isQuickMode === true || isQuickModeCalendarEvent(event),
  };
}

export function eventMatchesAccessTab(
  event: AccessEventCalendarRow,
  tab: AccessEventListTab,
  today: Date = startOfTodayLocal()
): boolean {
  const isQuick = event.isQuickMode === true || isQuickModeCalendarEvent(event);
  if (tab === 'quickMode') return isQuick;
  if (isQuick) return false;
  const days = accessEventNumberOfDays(event);
  if (tab === 'upcoming') return isEventUpcoming(event.date, days, today);
  return isEventPast(event.date, days, today);
}

export function filterEventsForAccessTab(
  events: AccessEventCalendarRow[],
  tab: AccessEventListTab,
  search = ''
): AccessEventCalendarRow[] {
  const q = search.trim().toLowerCase();
  const today = startOfTodayLocal();
  const filtered = events.filter((event) => {
    if (!eventMatchesAccessTab(event, tab, today)) return false;
    if (!q) return true;
    return (
      event.name.toLowerCase().includes(q) ||
      event.id.toLowerCase().includes(q) ||
      event.date.includes(q)
    );
  });

  return filtered.sort((a, b) => {
    const dateA = parseEventDateLocal(a.date)?.getTime() ?? 0;
    const dateB = parseEventDateLocal(b.date)?.getTime() ?? 0;
    return tab === 'upcoming' ? dateA - dateB : dateB - dateA;
  });
}

export function countEventsByAccessTab(events: AccessEventCalendarRow[]): Record<AccessEventListTab, number> {
  const today = startOfTodayLocal();
  return {
    upcoming: events.filter((e) => eventMatchesAccessTab(e, 'upcoming', today)).length,
    past: events.filter((e) => eventMatchesAccessTab(e, 'past', today)).length,
    quickMode: events.filter((e) => eventMatchesAccessTab(e, 'quickMode', today)).length,
  };
}

export async function loadEventAccessForUser(
  fetchFn: (path: string, init?: RequestInit) => Promise<Response>,
  userId: string
): Promise<EventAccessLoadResult> {
  const res = await fetchFn(`/api/admin/access-requests/${userId}/event-access`);
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    event_ids?: string[];
    events?: AccessEventCalendarRow[];
    needsMigration?: boolean;
  };
  if (!res.ok) {
    return {
      event_ids: [],
      events: [],
      error: data.error || `HTTP ${res.status}`,
    };
  }
  const events = (Array.isArray(data.events) ? data.events : []).map(normalizeAccessEventRow);
  return {
    event_ids: Array.isArray(data.event_ids) ? data.event_ids : [],
    events,
    needsMigration: data.needsMigration === true,
    error: data.needsMigration ? 'Run migration 031 on Neon to enable per-user event access.' : undefined,
  };
}

export function eventIdsForVisibility(
  mode: EventVisibilityMode,
  selected: Set<string>
): string[] | null {
  if (mode === 'all') return [];
  return [...selected];
}

export function validateRestrictedSelection(
  mode: EventVisibilityMode,
  selected: Set<string>
): string | null {
  if (mode === 'restricted' && selected.size === 0) {
    return 'Select at least one event, or choose “All events”.';
  }
  return null;
}
