import { getApiBaseUrl } from '../services/api-client';
import { apiJsonHeaders } from './sessionAuth';

export interface EventShareSummary {
  id: string;
  name: string;
  date: string;
}

export type EventShareAccessStatus = 'needs_add' | 'already' | 'unrestricted';

export interface EventSharePreview {
  ok: boolean;
  event: EventShareSummary;
  accessStatus: EventShareAccessStatus;
  message: string;
  canAdd: boolean;
  error?: string;
  needsMigration?: boolean;
}

export interface EventShareCreateResult {
  ok: boolean;
  event?: EventShareSummary;
  shareUrl?: string;
  reused?: boolean;
  error?: string;
  needsMigration?: boolean;
}

export interface EventShareAcceptResult {
  ok: boolean;
  status?: 'added' | 'already' | 'unrestricted' | 'error';
  event?: EventShareSummary;
  message?: string;
  error?: string;
  needsMigration?: boolean;
}

async function shareFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = getApiBaseUrl();
  const headers = new Headers(init?.headers);
  const json = apiJsonHeaders();
  Object.entries(json).forEach(([key, value]) => headers.set(key, value));
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${base}${path}`, { ...init, headers });
}

export async function createEventShareLink(
  eventId: string,
  options?: { rotate?: boolean }
): Promise<EventShareCreateResult> {
  const res = await shareFetch(`/api/calendar-events/${encodeURIComponent(eventId)}/share-access`, {
    method: 'POST',
    body: JSON.stringify({ rotate: options?.rotate === true }),
  });
  const data = (await res.json().catch(() => ({}))) as EventShareCreateResult & { error?: string };
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
    shareUrl: data.shareUrl,
    reused: data.reused,
  };
}

export async function previewEventShare(token: string): Promise<EventSharePreview> {
  const res = await shareFetch(`/api/event-share/${encodeURIComponent(token)}`);
  const data = (await res.json().catch(() => ({}))) as EventSharePreview & { error?: string };
  if (!res.ok) {
    return {
      ok: false,
      event: { id: '', name: '', date: '' },
      accessStatus: 'already',
      message: data.error || `HTTP ${res.status}`,
      canAdd: false,
      error: data.error || `HTTP ${res.status}`,
      needsMigration: data.needsMigration,
    };
  }
  return data;
}

export async function acceptEventShare(token: string): Promise<EventShareAcceptResult> {
  const res = await shareFetch(`/api/event-share/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  const data = (await res.json().catch(() => ({}))) as EventShareAcceptResult & { error?: string };
  if (!res.ok) {
    return {
      ok: false,
      error: data.error || `HTTP ${res.status}`,
      needsMigration: data.needsMigration,
    };
  }
  return data;
}
