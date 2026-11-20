import { getApiBaseUrl } from '../services/api-client';
import { authHeaders } from './sessionAuth';

export type WebQaStatus = 'pending' | 'approved' | 'answered' | 'rejected' | 'archived';

export type WebQaSession = {
  id: string;
  event_id: string;
  public_token: string;
  title: string | null;
  is_open: boolean;
  created_at?: string;
  updated_at?: string;
};

export type WebQaQuestion = {
  id: string;
  event_id: string;
  session_id: string;
  cue_item_id?: number | null;
  author_name?: string | null;
  body: string;
  status: WebQaStatus;
  sort_order?: number;
  created_at: string;
  updated_at?: string;
  moderated_at?: string | null;
  moderated_by?: string | null;
};

export function webQaAudiencePath(token: string): string {
  return `/qa/${encodeURIComponent(token)}`;
}

export function webQaAudienceAbsoluteUrl(token: string, origin = window.location.origin): string {
  return `${origin.replace(/\/$/, '')}${webQaAudiencePath(token)}`;
}

export function webQaQrImageUrl(audienceUrl: string, size = 240): string {
  const data = encodeURIComponent(audienceUrl);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${data}&margin=8`;
}

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data;
}

export async function fetchWebQaSession(
  eventId: string,
  opts?: { title?: string }
): Promise<WebQaSession> {
  const q =
    opts?.title && opts.title.trim()
      ? `?title=${encodeURIComponent(opts.title.trim())}`
      : '';
  const res = await fetch(
    `${getApiBaseUrl()}/api/web-qa/${encodeURIComponent(eventId)}/session${q}`,
    {
      headers: { ...authHeaders(), Accept: 'application/json' },
    }
  );
  const data = await parseJson(res);
  return data.session as WebQaSession;
}

export async function patchWebQaSession(
  eventId: string,
  patch: { is_open?: boolean; title?: string }
): Promise<WebQaSession> {
  const res = await fetch(`${getApiBaseUrl()}/api/web-qa/${encodeURIComponent(eventId)}/session`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await parseJson(res);
  return data.session as WebQaSession;
}

export async function rotateWebQaSession(eventId: string): Promise<WebQaSession> {
  const res = await fetch(
    `${getApiBaseUrl()}/api/web-qa/${encodeURIComponent(eventId)}/session/rotate`,
    {
      method: 'POST',
      headers: { ...authHeaders(), Accept: 'application/json' },
    }
  );
  const data = await parseJson(res);
  return data.session as WebQaSession;
}

export async function fetchWebQaQuestions(
  eventId: string,
  status: WebQaStatus | 'all' = 'all'
): Promise<WebQaQuestion[]> {
  const q = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(
    `${getApiBaseUrl()}/api/web-qa/${encodeURIComponent(eventId)}/questions${q}`,
    { headers: { ...authHeaders(), Accept: 'application/json' } }
  );
  const data = await parseJson(res);
  return (data.questions || []) as WebQaQuestion[];
}

export async function updateWebQaQuestionStatus(
  id: string,
  status: WebQaStatus,
  moderatedBy?: string
): Promise<WebQaQuestion> {
  const res = await fetch(`${getApiBaseUrl()}/api/web-qa/questions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ status, moderated_by: moderatedBy || null }),
  });
  const data = await parseJson(res);
  return data.question as WebQaQuestion;
}

export async function deleteWebQaQuestion(id: string): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/api/web-qa/questions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...authHeaders(), Accept: 'application/json' },
  });
  await parseJson(res);
}

export async function fetchPublicWebQa(token: string): Promise<{
  title: string;
  is_open: boolean;
  event_id: string;
}> {
  const res = await fetch(`${getApiBaseUrl()}/api/web-qa/public/${encodeURIComponent(token)}`, {
    headers: { Accept: 'application/json' },
  });
  return parseJson(res);
}

export async function submitPublicWebQa(
  token: string,
  payload: { body: string; author_name?: string }
): Promise<{ ok: boolean; id: string }> {
  const res = await fetch(
    `${getApiBaseUrl()}/api/web-qa/public/${encodeURIComponent(token)}/questions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  return parseJson(res);
}
