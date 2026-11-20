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

export type WebQaCueSummary = {
  id: number;
  cue: string | null;
  segment_name: string | null;
  has_qa: boolean;
  qa_display_mode?: string | null;
  question_count?: number;
};

export type WebQaOverview = {
  session: WebQaSession;
  current_cue: WebQaCueSummary | null;
  in_qa_cue: boolean;
  open_reason: 'in_qa_cue' | 'out_of_qa_cue' | string;
  qa_cues: WebQaCueSummary[];
  timer: {
    item_id: number | null;
    is_running: boolean;
    is_active: boolean;
    cue_is: string | null;
  } | null;
  counts: {
    pending: number;
    approved: number;
    answered: number;
    rejected: number;
    archived: number;
    all: number;
  };
  question_total: number;
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

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildWebQaQuestionsCsv(
  questions: WebQaQuestion[],
  cueLookup: Map<number, { cue?: string | null; segment_name?: string | null }>
): string {
  const header = [
    'created_at',
    'status',
    'author_name',
    'body',
    'cue',
    'segment_name',
    'cue_item_id',
    'moderated_at',
    'moderated_by',
    'id',
  ];
  const lines = [header.join(',')];
  for (const q of questions) {
    const cueId = q.cue_item_id != null ? Number(q.cue_item_id) : null;
    const meta = cueId != null ? cueLookup.get(cueId) : undefined;
    lines.push(
      [
        q.created_at,
        q.status,
        q.author_name || '',
        q.body,
        meta?.cue || '',
        meta?.segment_name || '',
        cueId != null ? String(cueId) : '',
        q.moderated_at || '',
        q.moderated_by || '',
        q.id,
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return lines.join('\n');
}

export function downloadTextFile(filename: string, contents: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data;
}

export async function fetchWebQaOverview(
  eventId: string,
  opts?: { title?: string }
): Promise<WebQaOverview> {
  const q =
    opts?.title && opts.title.trim()
      ? `?title=${encodeURIComponent(opts.title.trim())}`
      : '';
  const res = await fetch(
    `${getApiBaseUrl()}/api/web-qa/${encodeURIComponent(eventId)}/overview${q}`,
    {
      headers: { ...authHeaders(), Accept: 'application/json' },
    }
  );
  return parseJson(res) as Promise<WebQaOverview>;
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
  in_qa_cue?: boolean;
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
