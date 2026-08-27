import { getApiBaseUrl } from '../services/api-client';
import { apiJsonHeaders } from './sessionAuth';
import type { GuestEventPayload } from './eventGuestLinks';

/** Authenticated read-only event payload for Creative role (guest-style schedule + timer). */
export async function fetchCreativeEvent(eventId: string): Promise<GuestEventPayload> {
  const base = getApiBaseUrl();
  const headers = apiJsonHeaders();
  const res = await fetch(`${base}/api/creative-event/${encodeURIComponent(eventId)}`, { headers });
  const data = (await res.json().catch(() => ({}))) as GuestEventPayload & { error?: string };
  if (!res.ok) {
    return {
      ok: false,
      error: data.error || `HTTP ${res.status}`,
    };
  }
  return { ok: true, ...data };
}
