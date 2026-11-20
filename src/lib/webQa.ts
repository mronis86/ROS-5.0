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
  author_email?: string | null;
  body: string;
  status: WebQaStatus;
  /** Selected for showcase / live display queue. */
  is_queued?: boolean;
  /** On-air / ACTIVE for graphics — only one per event. */
  is_active?: boolean;
  /** Past visible soft limit — report/export only. */
  is_overflow?: boolean;
  /** 1-based order when queued. */
  sort_order?: number;
  created_at: string;
  updated_at?: string;
  moderated_at?: string | null;
  moderated_by?: string | null;
};

/** Live mod UI soft cap; overflow still stores with email. */
export const WEB_QA_VISIBLE_SOFT_LIMIT = 300;
/** Realistic single spoken question (~tweet–paragraph). Enforced client + API. */
export const WEB_QA_MAX_BODY_CHARS = 400;

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
  soft_limit?: number;
  visible_count?: number;
  overflow_count?: number;
  at_soft_limit?: boolean;
  active_question?: WebQaQuestion | null;
};

export function webQaAudiencePath(token: string): string {
  return `/qa/${encodeURIComponent(token)}`;
}

export function webQaAudienceAbsoluteUrl(token: string, origin = window.location.origin): string {
  return `${origin.replace(/\/$/, '')}${webQaAudiencePath(token)}`;
}

export type WebQaQrDownloadOptions = {
  /** Pixel size of the QR modules area (before border). */
  size?: number;
  /** Hex foreground, with or without #. */
  fg?: string;
  /** Hex background, or 'transparent'. */
  bg?: 'transparent' | string;
  /** Quiet-zone modules (0–50). */
  margin?: number;
  /** Outer border thickness in px (0 = none). */
  borderPx?: number;
  /** Border color hex. */
  borderColor?: string;
};

function hexNoHash(value: string | undefined, fallback: string): string {
  const raw = String(value || fallback).trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw) ? raw : fallback;
}

function hexWithHash(value: string | undefined, fallback: string): string {
  return `#${hexNoHash(value, fallback)}`;
}

/** On-page preview URL (api.qrserver). */
export function webQaQrImageUrl(
  audienceUrl: string,
  sizeOrOpts: number | WebQaQrDownloadOptions = 240
): string {
  const opts: WebQaQrDownloadOptions =
    typeof sizeOrOpts === 'number' ? { size: sizeOrOpts } : sizeOrOpts || {};
  const size = Math.max(64, Math.min(2048, Math.floor(Number(opts.size) || 240)));
  const margin = Math.max(0, Math.min(50, Math.floor(Number(opts.margin) ?? 4)));
  const fg = hexNoHash(opts.fg, '000000');
  // API needs a solid bgcolor; transparent is handled in download compositing.
  const bg =
    opts.bg === 'transparent' ? 'ffffff' : hexNoHash(opts.bg, 'ffffff');
  const data = encodeURIComponent(audienceUrl);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${data}&margin=${margin}&color=${fg}&bgcolor=${bg}&format=png`;
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load QR image'));
    };
    img.src = url;
  });
}

/** Build a styled PNG blob for download (supports transparent bg + border). */
export async function buildWebQaQrPngBlob(
  audienceUrl: string,
  opts: WebQaQrDownloadOptions = {}
): Promise<Blob> {
  const size = Math.max(256, Math.min(2048, Math.floor(Number(opts.size) || 1024)));
  const margin = Math.max(0, Math.min(50, Math.floor(Number(opts.margin) ?? 4)));
  const borderPx = Math.max(0, Math.min(120, Math.floor(Number(opts.borderPx) || 0)));
  const transparent = opts.bg === 'transparent';
  const fg = hexNoHash(opts.fg, '000000');
  const bgSolid = transparent ? 'ffffff' : hexNoHash(opts.bg, 'ffffff');
  const borderColor = hexWithHash(opts.borderColor, '000000');

  const srcUrl = webQaQrImageUrl(audienceUrl, {
    size,
    margin,
    fg,
    bg: bgSolid,
  });
  const res = await fetch(srcUrl);
  if (!res.ok) throw new Error(`QR fetch failed (${res.status})`);
  const img = await loadImageFromBlob(await res.blob());

  const canvas = document.createElement('canvas');
  canvas.width = size + borderPx * 2;
  canvas.height = size + borderPx * 2;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas unavailable');

  if (borderPx > 0) {
    ctx.fillStyle = borderColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (!transparent) {
    ctx.fillStyle = hexWithHash(bgSolid, 'ffffff');
    ctx.fillRect(borderPx, borderPx, size, size);
  } else if (borderPx > 0) {
    ctx.clearRect(borderPx, borderPx, size, size);
  }

  ctx.drawImage(img, borderPx, borderPx, size, size);

  if (transparent) {
    // Only punch the QR area so a light border stays solid.
    const imageData = ctx.getImageData(borderPx, borderPx, size, size);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // Punch near-white (QR quiet zone / modules bg) to alpha 0.
      if (r > 245 && g > 245 && b > 245) {
        data[i + 3] = 0;
      }
    }
    ctx.putImageData(imageData, borderPx, borderPx);
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  );
  if (!blob) throw new Error('PNG encode failed');
  return blob;
}

export async function downloadWebQaQrPng(
  audienceUrl: string,
  filename: string,
  opts: WebQaQrDownloadOptions = {}
): Promise<void> {
  const blob = await buildWebQaQrPngBlob(audienceUrl, opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
    'is_overflow',
    'author_name',
    'author_email',
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
        q.is_overflow ? 'yes' : 'no',
        q.author_name || '',
        q.author_email || '',
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
  status: WebQaStatus | 'all' = 'all',
  opts?: { includeOverflow?: boolean }
): Promise<WebQaQuestion[]> {
  const params = new URLSearchParams();
  if (status && status !== 'all') params.set('status', status);
  if (opts?.includeOverflow) params.set('include_overflow', '1');
  const q = params.toString() ? `?${params.toString()}` : '';
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
  return patchWebQaQuestion(id, { status, moderated_by: moderatedBy });
}

export async function patchWebQaQuestion(
  id: string,
  patch: {
    status?: WebQaStatus;
    is_queued?: boolean;
    is_active?: boolean;
    mark_done?: boolean;
    queue_order?: number;
    moderated_by?: string;
  }
): Promise<WebQaQuestion> {
  const body: Record<string, unknown> = {
    moderated_by: patch.moderated_by || null,
  };
  if (patch.status != null) body.status = patch.status;
  if (typeof patch.is_queued === 'boolean') body.is_queued = patch.is_queued;
  if (typeof patch.is_active === 'boolean') body.is_active = patch.is_active;
  if (patch.mark_done === true) body.mark_done = true;
  if (patch.queue_order != null) body.queue_order = patch.queue_order;

  const res = await fetch(`${getApiBaseUrl()}/api/web-qa/questions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  return data.question as WebQaQuestion;
}

/** Promote a queued (or approved) question to the single on-air ACTIVE slot. */
export async function activateWebQaQuestion(
  id: string,
  moderatedBy?: string
): Promise<WebQaQuestion> {
  return patchWebQaQuestion(id, { is_active: true, moderated_by: moderatedBy });
}

/** Mark ACTIVE Done/answered so the next queued question can go on-air. */
export async function completeWebQaQuestion(
  id: string,
  moderatedBy?: string
): Promise<WebQaQuestion> {
  return patchWebQaQuestion(id, { mark_done: true, moderated_by: moderatedBy });
}

export async function reorderWebQaQueue(
  eventId: string,
  orderedIds: string[],
  moderatedBy?: string,
  scope: 'queued' | 'approved' = 'queued'
): Promise<WebQaQuestion[]> {
  const res = await fetch(`${getApiBaseUrl()}/api/web-qa/${encodeURIComponent(eventId)}/queue`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      ordered_ids: orderedIds,
      moderated_by: moderatedBy || null,
      scope,
    }),
  });
  const data = await parseJson(res);
  return (data.questions || []) as WebQaQuestion[];
}

/** Reorder approved questions for Reader (Make Active order). */
export async function reorderWebQaApproved(
  eventId: string,
  orderedIds: string[],
  moderatedBy?: string
): Promise<WebQaQuestion[]> {
  return reorderWebQaQueue(eventId, orderedIds, moderatedBy, 'approved');
}

export async function deleteWebQaQuestion(id: string): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/api/web-qa/questions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...authHeaders(), Accept: 'application/json' },
  });
  await parseJson(res);
}

export type PublicWebQaSession = {
  title: string;
  is_open: boolean;
  event_id: string;
  in_qa_cue?: boolean;
  soft_limit?: number;
  visible_count?: number;
  at_soft_limit?: boolean;
  current_cue?: {
    id: number | null;
    cue: string | null;
    segment_name: string | null;
    has_qa?: boolean;
  } | null;
};

/** Live vMix CSV of waiting queued questions (not ACTIVE). */
export function webQaQueueCsvUrl(eventId: string, opts?: { row?: number }): string {
  const q = new URLSearchParams({ eventId });
  if (opts?.row != null && Number.isFinite(opts.row) && opts.row >= 1) {
    q.set('row', String(Math.floor(opts.row)));
  }
  return `${getApiBaseUrl()}/api/web-qa-queue.csv?${q.toString()}`;
}

/** Live vMix CSV for the single on-air ACTIVE question (header-only when empty). */
export function webQaActiveCsvUrl(eventId: string): string {
  return `${getApiBaseUrl()}/api/web-qa-active.csv?eventId=${encodeURIComponent(eventId)}`;
}

export async function fetchPublicWebQa(token: string): Promise<PublicWebQaSession> {
  const res = await fetch(`${getApiBaseUrl()}/api/web-qa/public/${encodeURIComponent(token)}`, {
    headers: { Accept: 'application/json' },
  });
  return parseJson(res) as Promise<PublicWebQaSession>;
}

export async function submitPublicWebQa(
  token: string,
  payload: { body: string; author_name?: string; author_email?: string }
): Promise<{ ok: boolean; id: string; is_overflow?: boolean }> {
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
