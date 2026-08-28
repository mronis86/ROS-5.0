import { getApiBaseUrl } from '../services/api-client';
import { apiJsonHeaders } from './sessionAuth';

export type ContentReviewAssignee = {
  id: string;
  access_id: string;
  assignee_role: 'creative' | 'production';
  email: string;
  full_name: string;
  notify_on_change: boolean;
};

export type ContentReviewAssigneeCandidate = {
  id: string;
  email: string;
  full_name: string;
  is_creative: boolean;
  is_admin: boolean;
  is_event_manager: boolean;
};

export type ContentReviewAssigneesPayload = {
  event_id: string;
  assignees: {
    creative: ContentReviewAssignee[];
    production: ContentReviewAssignee[];
  };
  candidates: {
    creative: ContentReviewAssigneeCandidate[];
    production: ContentReviewAssigneeCandidate[];
  };
  can_manage: boolean;
  max_per_role: number;
};

async function parseJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchContentReviewAssignees(eventId: string): Promise<{
  data: ContentReviewAssigneesPayload | null;
  error: string | null;
}> {
  try {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/content-review/${encodeURIComponent(eventId)}/assignees`, {
      headers: apiJsonHeaders(),
    });
    const body = await parseJson<{ error?: string } & ContentReviewAssigneesPayload>(res);
    if (!res.ok) {
      return { data: null, error: body?.error || `Failed to load assignees (${res.status})` };
    }
    return { data: body as ContentReviewAssigneesPayload, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Failed to load assignees' };
  }
}

export async function saveContentReviewAssignees(
  eventId: string,
  payload: { creative: string[]; production: string[] }
): Promise<{ data: ContentReviewAssigneesPayload | null; error: string | null }> {
  try {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/content-review/${encodeURIComponent(eventId)}/assignees`, {
      method: 'PUT',
      headers: apiJsonHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const body = await parseJson<{ error?: string; assignees?: ContentReviewAssigneesPayload['assignees'] }>(res);
    if (!res.ok) {
      return { data: null, error: body?.error || `Failed to save assignees (${res.status})` };
    }
    return {
      data: {
        event_id: eventId,
        assignees: body?.assignees || { creative: [], production: [] },
        candidates: { creative: [], production: [] },
        can_manage: true,
        max_per_role: 2,
      },
      error: null,
    };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Failed to save assignees' };
  }
}

export function assigneeDisplayName(row: { full_name?: string; email?: string }): string {
  const name = (row.full_name || '').trim();
  if (name) return name;
  return (row.email || '').trim() || 'User';
}
