import { getApiBaseUrl } from '../services/api-client';
import { apiJsonHeaders } from './sessionAuth';

export type StreamRequestFormPayload = {
  ok: boolean;
  event?: { id: string; name: string; date: string; location?: string };
  alreadySubmitted?: boolean;
  existing?: {
    youtubeChannel?: string;
    youtubeChannelOther?: string;
    visibility?: string;
    shareWith?: string;
    requestContactName?: string;
    requestContactEmail?: string;
    requestSubmittedAt?: string;
  };
  options?: {
    youtubeChannels: string[];
    visibilities: string[];
  };
  error?: string;
  needsMigration?: boolean;
};

export type StreamRequestLinkCreateResult = {
  ok: boolean;
  streamRequestUrl?: string;
  reused?: boolean;
  createdAt?: string;
  error?: string;
  needsMigration?: boolean;
};

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

export async function createStreamRequestLink(
  eventId: string,
  opts?: { rotate?: boolean }
): Promise<StreamRequestLinkCreateResult> {
  try {
    const res = await authedFetch(
      `/api/calendar-events/${encodeURIComponent(eventId)}/stream-request-link`,
      {
        method: 'POST',
        body: JSON.stringify({ rotate: !!opts?.rotate }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as StreamRequestLinkCreateResult;
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || `Could not create link (${res.status})`,
        needsMigration: data.needsMigration,
      };
    }
    return data;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not create link' };
  }
}

export async function fetchStreamRequestForm(token: string): Promise<StreamRequestFormPayload> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/stream-request/${encodeURIComponent(token)}`);
  const data = (await res.json().catch(() => ({}))) as StreamRequestFormPayload;
  if (!res.ok) {
    return {
      ok: false,
      error: data.error || `Could not load form (${res.status})`,
      needsMigration: data.needsMigration,
    };
  }
  return data;
}

export async function submitStreamRequestForm(
  token: string,
  body: Record<string, string>
): Promise<{ ok: boolean; message?: string; error?: string; needsMigration?: boolean }> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/stream-request/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    error?: string;
    needsMigration?: boolean;
  };
  if (!res.ok) {
    return {
      ok: false,
      error: data.error || `Submit failed (${res.status})`,
      needsMigration: data.needsMigration,
    };
  }
  return { ok: true, message: data.message || 'Submitted.' };
}
