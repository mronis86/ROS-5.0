/**
 * Per-event engagement — one audience link for live Q&A + polls.
 */

import { getApiBaseUrl } from '../services/api-client';
import { authHeaders } from './sessionAuth';
import type { PublicEventPoll } from './webPolls';

function apiBase() {
  return getApiBaseUrl() || '';
}

export type EngagementSession = {
  id?: string;
  event_id: string;
  public_token: string;
  title?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type PublicEngagement = {
  title: string;
  event_id: string;
  public_token: string;
  show_qa: boolean;
  show_poll: boolean;
  default_tab: 'qa' | 'poll' | 'wait';
  qa: {
    public_token: string;
    is_open: boolean;
    in_qa_cue: boolean;
    at_soft_limit: boolean;
    soft_limit?: number;
    current_cue?: {
      id: number | null;
      cue: string | null;
      segment_name: string | null;
      has_qa?: boolean;
    } | null;
  } | null;
  poll: {
    open_polls: PublicEventPoll[];
    active_poll: PublicEventPoll | null;
    current_cue?: unknown;
    in_poll_cue?: boolean;
  } | null;
};

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || res.statusText || 'Request failed');
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return data;
}

export function webEngagementAudienceUrl(token: string, origin = window.location.origin) {
  return `${origin.replace(/\/$/, '')}/engage/${encodeURIComponent(token)}`;
}

export async function fetchEngagementSession(
  eventId: string,
  opts?: { title?: string }
): Promise<EngagementSession> {
  const qs =
    opts?.title && opts.title !== 'Event'
      ? `?title=${encodeURIComponent(opts.title)}`
      : '';
  const res = await fetch(
    `${apiBase()}/api/engagement/${encodeURIComponent(eventId)}/session${qs}`,
    { headers: { ...authHeaders(), Accept: 'application/json' } }
  );
  const data = await parseJson(res);
  return data.session;
}

export async function rotateEngagementSession(eventId: string): Promise<EngagementSession> {
  const res = await fetch(
    `${apiBase()}/api/engagement/${encodeURIComponent(eventId)}/session/rotate`,
    {
      method: 'POST',
      headers: { ...authHeaders(), Accept: 'application/json' },
    }
  );
  const data = await parseJson(res);
  return data.session;
}

export async function fetchPublicEngagement(token: string): Promise<PublicEngagement> {
  const res = await fetch(
    `${apiBase()}/api/engagement/public/${encodeURIComponent(token)}`,
    { headers: { Accept: 'application/json' } }
  );
  return parseJson(res) as Promise<PublicEngagement>;
}
