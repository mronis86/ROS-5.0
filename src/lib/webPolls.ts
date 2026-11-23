/**
 * Client helpers for live web polls (soft Neon inbox → drain → rollup).
 */

import { getApiBaseUrl } from '../services/api-client';
import { authHeaders } from './sessionAuth';

function apiBase() {
  return getApiBaseUrl() || '';
}

export type WebPollType = 'single' | 'multi' | 'yesno' | 'rating' | 'ranked';
export type WebPollStatus = 'draft' | 'open' | 'closed' | 'finalizing' | 'final';
export type PollInboxBackend = 'neon' | 'redis';

export type WebPollOption = {
  id: string;
  label: string;
  color?: string | null;
  sort_order: number;
  vote_count?: number;
};

export type WebPoll = {
  id: string;
  event_id: string;
  public_token: string;
  question: string;
  poll_type: WebPollType;
  status: WebPollStatus;
  cue_item_id?: number | null;
  received_count: number;
  counted_count: number;
  results_snapshot?: Record<string, unknown> | null;
  options?: WebPollOption[];
  opened_at?: string | null;
  closed_at?: string | null;
  finalized_at?: string | null;
  created_at?: string;
  updated_at?: string;
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

export async function fetchPollInboxBackend(): Promise<{
  poll_inbox_backend: PollInboxBackend;
  redis_configured: boolean;
}> {
  const res = await fetch(`${apiBase()}/api/web-polls/inbox-backend`, {
    headers: { ...authHeaders(), Accept: 'application/json' },
  });
  return parseJson(res);
}

export async function setPollInboxBackend(backend: PollInboxBackend) {
  const res = await fetch(`${apiBase()}/api/web-polls/inbox-backend`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ poll_inbox_backend: backend }),
  });
  return parseJson(res);
}

export async function listWebPolls(eventId: string): Promise<WebPoll[]> {
  const res = await fetch(`${apiBase()}/api/web-polls/${encodeURIComponent(eventId)}`, {
    headers: { ...authHeaders(), Accept: 'application/json' },
  });
  const data = await parseJson(res);
  return data.polls || [];
}

export async function createWebPoll(
  eventId: string,
  body: {
    question: string;
    pollType: WebPollType;
    options?: { label: string; color?: string }[];
    cueItemId?: number | null;
  }
): Promise<WebPoll> {
  const res = await fetch(`${apiBase()}/api/web-polls/${encodeURIComponent(eventId)}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      question: body.question,
      poll_type: body.pollType,
      options: body.options,
      cue_item_id: body.cueItemId,
    }),
  });
  const data = await parseJson(res);
  return data.poll;
}

export async function fetchWebPoll(pollId: string): Promise<WebPoll> {
  const res = await fetch(`${apiBase()}/api/web-polls/poll/${encodeURIComponent(pollId)}`, {
    headers: { ...authHeaders(), Accept: 'application/json' },
  });
  const data = await parseJson(res);
  return data.poll;
}

export async function setWebPollStatus(pollId: string, status: WebPollStatus): Promise<WebPoll> {
  const res = await fetch(`${apiBase()}/api/web-polls/poll/${encodeURIComponent(pollId)}/status`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ status }),
  });
  const data = await parseJson(res);
  return data.poll;
}

export async function drainWebPoll(pollId: string, limit = 100) {
  const res = await fetch(`${apiBase()}/api/web-polls/poll/${encodeURIComponent(pollId)}/drain`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ limit }),
  });
  return parseJson(res);
}

export async function fetchWebPollRollup(pollId: string) {
  const res = await fetch(`${apiBase()}/api/web-polls/poll/${encodeURIComponent(pollId)}/rollup`, {
    headers: { ...authHeaders(), Accept: 'application/json' },
  });
  return parseJson(res);
}

export async function fetchPublicWebPoll(token: string) {
  const res = await fetch(`${apiBase()}/api/web-polls/public/${encodeURIComponent(token)}`);
  return parseJson(res);
}

export async function fetchPublicWebPollRollup(token: string) {
  const res = await fetch(`${apiBase()}/api/web-polls/public/${encodeURIComponent(token)}/rollup`);
  return parseJson(res);
}

export async function submitPublicWebPollVote(
  token: string,
  payload: Record<string, unknown>,
  voterKey?: string
) {
  const res = await fetch(`${apiBase()}/api/web-polls/public/${encodeURIComponent(token)}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ payload, voter_key: voterKey }),
  });
  return parseJson(res);
}

export function webPollAudienceUrl(token: string, origin = window.location.origin) {
  return `${origin}/poll/${encodeURIComponent(token)}`;
}
