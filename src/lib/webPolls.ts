/**
 * Client helpers for live web polls (soft Neon inbox → drain → rollup).
 */

import { getApiBaseUrl } from '../services/api-client';
import { authHeaders } from './sessionAuth';
import {
  normalizeWebPollDisplayStyle,
  type WebPollDisplayStyle,
} from './webPollDisplayStyle';

export type { WebPollDisplayStyle } from './webPollDisplayStyle';
export { DEFAULT_DISPLAY_STYLE, normalizeWebPollDisplayStyle } from './webPollDisplayStyle';

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
  display_style?: WebPollDisplayStyle | Record<string, unknown> | null;
  options?: WebPollOption[];
  design_confirmed?: boolean;
  design_lock_owner?: string | null;
  design_lock_name?: string | null;
  design_lock_until?: string | null;
  opened_at?: string | null;
  closed_at?: string | null;
  finalized_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export function webPollDesignFrozen(poll: Pick<WebPoll, 'status'> | null | undefined) {
  return poll?.status === 'open';
}

export function webPollDesignLockActive(poll: Pick<WebPoll, 'design_lock_owner' | 'design_lock_until'> | null | undefined) {
  if (!poll?.design_lock_owner || !poll?.design_lock_until) return false;
  const until = new Date(poll.design_lock_until).getTime();
  return Number.isFinite(until) && until > Date.now();
}

export function webPollDisplayStyle(poll: {
  display_style?: unknown;
  poll_type?: WebPollType | string | null;
}): WebPollDisplayStyle {
  return normalizeWebPollDisplayStyle(poll.display_style, poll.poll_type);
}

export type WebPollCueSummary = {
  id: number;
  cue: string | null;
  segment_name: string | null;
  has_poll: boolean;
  poll_count?: number;
  open_count?: number;
  polls?: WebPoll[];
};

export type WebPollSession = {
  id?: string;
  event_id: string;
  public_token: string;
  title?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type WebPollOverview = {
  session: WebPollSession;
  poll_cues: WebPollCueSummary[];
  polls: WebPoll[];
  current_cue: WebPollCueSummary | null;
  in_poll_cue: boolean;
  timer: {
    item_id: number | null;
    is_running: boolean;
    is_active: boolean;
    cue_is: string | null;
  } | null;
  counts: {
    draft: number;
    open: number;
    closed: number;
    finalizing: number;
    final: number;
    all: number;
  };
};

export type PublicEventPoll = {
  id: string;
  public_token: string;
  question: string;
  poll_type: WebPollType;
  status: WebPollStatus;
  cue_item_id?: number | null;
  display_style?: WebPollDisplayStyle | Record<string, unknown> | null;
  options: WebPollOption[];
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

export async function fetchWebPollOverview(eventId: string): Promise<WebPollOverview> {
  const res = await fetch(
    `${apiBase()}/api/web-polls/${encodeURIComponent(eventId)}/overview`,
    { headers: { ...authHeaders(), Accept: 'application/json' } }
  );
  return parseJson(res);
}

export async function rotateWebPollSession(eventId: string): Promise<WebPollSession> {
  const res = await fetch(
    `${apiBase()}/api/web-polls/${encodeURIComponent(eventId)}/session/rotate`,
    {
      method: 'POST',
      headers: { ...authHeaders(), Accept: 'application/json' },
    }
  );
  const data = await parseJson(res);
  return data.session;
}

export async function fetchPublicEventPolls(token: string) {
  const res = await fetch(
    `${apiBase()}/api/web-polls/public-event/${encodeURIComponent(token)}`
  );
  return parseJson(res) as Promise<{
    session: WebPollSession;
    current_cue: WebPollCueSummary | null;
    in_poll_cue: boolean;
    open_polls: PublicEventPoll[];
    active_poll: PublicEventPoll | null;
  }>;
}

export function webPollEventAudienceUrl(token: string, origin = window.location.origin) {
  return `${origin.replace(/\/$/, '')}/polls/${encodeURIComponent(token)}`;
}

/** Preview QR (same generator as Web Q&A). */
export function webPollQrImageUrl(audienceUrl: string, size = 140) {
  const n = Math.max(64, Math.min(1024, Math.floor(size) || 140));
  return `https://api.qrserver.com/v1/create-qr-code/?size=${n}x${n}&data=${encodeURIComponent(audienceUrl)}&margin=4&color=000000&bgcolor=ffffff&format=png`;
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
    /** Required — must be a ROS cue with Poll checked. */
    cueItemId: number;
    displayStyle?: WebPollDisplayStyle;
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
      display_style: body.displayStyle,
    }),
  });
  const data = await parseJson(res);
  return data.poll;
}

/** Edit question / type / options. Blocked while open; type/options blocked after votes. */
export async function updateWebPoll(
  pollId: string,
  body: {
    question?: string;
    pollType?: WebPollType;
    options?: { label: string; color?: string }[];
  }
): Promise<WebPoll> {
  const res = await fetch(`${apiBase()}/api/web-polls/poll/${encodeURIComponent(pollId)}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      question: body.question,
      poll_type: body.pollType,
      options: body.options,
    }),
  });
  const data = await parseJson(res);
  return data.poll;
}

export async function updateWebPollDisplayStyle(
  pollId: string,
  displayStyle: WebPollDisplayStyle,
  opts?: { recolorOptions?: boolean; designConfirmed?: boolean }
): Promise<WebPoll> {
  const res = await fetch(
    `${apiBase()}/api/web-polls/poll/${encodeURIComponent(pollId)}/display-style`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        display_style: displayStyle,
        recolorOptions: opts?.recolorOptions !== false,
        design_confirmed: opts?.designConfirmed === true,
      }),
    }
  );
  const data = await parseJson(res);
  return data.poll;
}

export function buildWebPollsCsv(
  polls: WebPoll[],
  cueLookup?: Map<number, { cue?: string | null; segment_name?: string | null }>
): string {
  const header = [
    'Poll ID',
    'Status',
    'Type',
    'Question',
    'Cue',
    'Segment',
    'Received',
    'Counted',
    'Audience URL',
    'Opened At',
    'Closed At',
    'Finalized At',
  ];
  const escape = (v: unknown) => {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const rows = polls.map((p) => {
    const cueId = Number(p.cue_item_id);
    const cueMeta = Number.isFinite(cueId) ? cueLookup?.get(cueId) : undefined;
    return [
      p.id,
      p.status,
      p.poll_type,
      p.question,
      cueMeta?.cue || '',
      cueMeta?.segment_name || '',
      p.received_count ?? 0,
      p.counted_count ?? 0,
      p.public_token ? webPollAudienceUrl(p.public_token) : '',
      p.opened_at || '',
      p.closed_at || '',
      p.finalized_at || '',
    ]
      .map(escape)
      .join(',');
  });
  return '\uFEFF' + [header.join(','), ...rows].join('\n');
}

export function downloadTextFile(filename: string, contents: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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

export type WebPollSurfaceKind = 'stage' | 'lower' | 'pip';

/** Transparent overlay URLs for broadcast / event graphics. */
export function webPollSurfaceUrl(
  token: string,
  surface: WebPollSurfaceKind,
  origin = window.location.origin
) {
  return `${origin.replace(/\/$/, '')}/poll-surface/${encodeURIComponent(token)}/${surface}`;
}

/** Partial write: flip surfaces.onAir only (no full design replace). */
export async function setWebPollOnAir(pollId: string, onAir: boolean): Promise<WebPoll> {
  const res = await fetch(
    `${apiBase()}/api/web-polls/poll/${encodeURIComponent(pollId)}/on-air`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ onAir: Boolean(onAir) }),
    }
  );
  const data = await parseJson(res);
  return data.poll;
}

export async function acquireWebPollDesignLock(pollId: string): Promise<WebPoll> {
  const res = await fetch(
    `${apiBase()}/api/web-polls/poll/${encodeURIComponent(pollId)}/design-lock`,
    {
      method: 'POST',
      headers: { ...authHeaders(), Accept: 'application/json' },
    }
  );
  const data = await parseJson(res);
  return data.poll;
}

export async function releaseWebPollDesignLock(pollId: string): Promise<WebPoll> {
  const res = await fetch(
    `${apiBase()}/api/web-polls/poll/${encodeURIComponent(pollId)}/design-lock`,
    {
      method: 'DELETE',
      headers: { ...authHeaders(), Accept: 'application/json' },
    }
  );
  const data = await parseJson(res);
  return data.poll;
}

export async function setWebPollDesignConfirmed(
  pollId: string,
  confirmed: boolean
): Promise<WebPoll> {
  const res = await fetch(
    `${apiBase()}/api/web-polls/poll/${encodeURIComponent(pollId)}/design-confirmed`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ design_confirmed: Boolean(confirmed) }),
    }
  );
  const data = await parseJson(res);
  return data.poll;
}
