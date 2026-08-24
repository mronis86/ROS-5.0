import { getApiBaseUrl } from '../services/api-client';
import { apiJsonHeaders } from './sessionAuth';

export interface GuestEventSummary {
  id: string;
  name: string;
  date: string;
  location?: string;
  numberOfDays?: number;
}

export interface GuestScheduleItem {
  id: number;
  day: number;
  segmentName: string;
  programType: string;
  shotType: string;
  durationHours: number;
  durationMinutes: number;
  durationSeconds: number;
  speakers: string;
  notes: string;
  cue: string;
  isIndented: boolean;
  hasPPT: boolean;
  hasQA: boolean;
}

export interface GuestActiveTimer {
  itemId: number | string;
  timerState?: string;
  isActive?: boolean;
  isRunning?: boolean;
  durationSeconds?: number;
  elapsedSeconds?: number;
  cueIs?: string;
}

export interface GuestEventPayload {
  ok: boolean;
  event?: GuestEventSummary;
  scheduleItems?: GuestScheduleItem[];
  activeTimer?: GuestActiveTimer | null;
  serverTime?: string;
  error?: string;
  needsMigration?: boolean;
}

export interface GuestLinkCreateResult {
  ok: boolean;
  event?: { id: string; name: string; date: string };
  guestUrl?: string;
  reused?: boolean;
  error?: string;
  needsMigration?: boolean;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = getApiBaseUrl();
  const headers = new Headers(init?.headers);
  const json = apiJsonHeaders();
  Object.entries(json).forEach(([key, value]) => headers.set(key, value));
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${base}${path}`, { ...init, headers });
}

/** Public — no auth headers required. */
export async function fetchGuestEvent(token: string): Promise<GuestEventPayload> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/guest-event/${encodeURIComponent(token)}`);
  const data = (await res.json().catch(() => ({}))) as GuestEventPayload & { error?: string };
  if (!res.ok) {
    return {
      ok: false,
      error: data.error || `HTTP ${res.status}`,
      needsMigration: data.needsMigration,
    };
  }
  return { ok: true, ...data };
}

export async function createGuestEventLink(
  eventId: string,
  options?: { rotate?: boolean }
): Promise<GuestLinkCreateResult> {
  const res = await authedFetch(`/api/calendar-events/${encodeURIComponent(eventId)}/guest-link`, {
    method: 'POST',
    body: JSON.stringify({ rotate: options?.rotate === true }),
  });
  const data = (await res.json().catch(() => ({}))) as GuestLinkCreateResult & { error?: string };
  if (!res.ok) {
    return {
      ok: false,
      error: data.error || `HTTP ${res.status}`,
      needsMigration: data.needsMigration,
    };
  }
  return {
    ok: true,
    event: data.event,
    guestUrl: data.guestUrl,
    reused: data.reused,
  };
}

export function formatGuestDuration(item: GuestScheduleItem): string {
  const h = Number(item.durationHours) || 0;
  const m = Number(item.durationMinutes) || 0;
  const s = Number(item.durationSeconds) || 0;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  if (s > 0) return `${s}s`;
  return '—';
}

export function stripHtmlNotes(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
