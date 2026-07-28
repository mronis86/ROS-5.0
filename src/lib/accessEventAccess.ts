export interface AccessEventCalendarRow {
  id: string;
  name: string;
  date: string;
}

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
  return {
    event_ids: Array.isArray(data.event_ids) ? data.event_ids : [],
    events: Array.isArray(data.events) ? data.events : [],
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
