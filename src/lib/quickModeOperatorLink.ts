import { getApiBaseUrl } from '../services/api-client';
import { apiAuthFetch, apiJsonHeaders, getApiAccessToken } from './sessionAuth';

export type QmOperatorLinkStatus = {
  ok: boolean;
  exists?: boolean;
  active?: boolean;
  operatorUrl?: string;
  token?: string;
  expiresAt?: string | null;
  createdAt?: string | null;
  lastUsedAt?: string | null;
  defaultHours?: number;
  error?: string;
  needsMigration?: boolean;
};

export type QmOperatorSession = {
  ok: boolean;
  expired?: boolean;
  eventId: string;
  eventName?: string;
  expiresAt?: string | null;
  token?: string;
  timers?: Array<{
    id: number;
    title: string;
    cue: string;
    durationMs: number;
    remainingMs: number;
    isRunning: boolean;
    startedAtMs: number | null;
  }>;
  error?: string;
};

export function formatQmExpiry(expiresAt?: string | null): string {
  if (!expiresAt) return '—';
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

export function qmLinkIsActive(expiresAt?: string | null): boolean {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  return Number.isFinite(ms) && ms > Date.now();
}

export async function fetchQmOperatorSession(token: string): Promise<{ status: number; data: QmOperatorSession }> {
  const res = await fetch(`${getApiBaseUrl()}/api/quick-mode-operator/${encodeURIComponent(token)}`);
  const data = (await res.json().catch(() => ({}))) as QmOperatorSession;
  return { status: res.status, data };
}

export async function fetchQmOperatorLinkStatus(eventId: string): Promise<QmOperatorLinkStatus | null> {
  if (!getApiAccessToken()) return null;
  const res = await apiAuthFetch(
    `${getApiBaseUrl()}/api/calendar-events/${encodeURIComponent(eventId)}/quick-mode-operator-link`
  );
  if (!res) return null;
  const data = (await res.json().catch(() => ({}))) as QmOperatorLinkStatus;
  if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}`, needsMigration: data.needsMigration };
  return data;
}

export async function updateQmOperatorLink(
  eventId: string,
  body: { hours?: number; expireNow?: boolean; rotate?: boolean }
): Promise<QmOperatorLinkStatus> {
  const res = await fetch(
    `${getApiBaseUrl()}/api/calendar-events/${encodeURIComponent(eventId)}/quick-mode-operator-link`,
    {
      method: 'POST',
      headers: apiJsonHeaders(),
      body: JSON.stringify(body),
    }
  );
  const data = (await res.json().catch(() => ({}))) as QmOperatorLinkStatus;
  if (!res.ok) {
    return { ok: false, error: data.error || `HTTP ${res.status}`, needsMigration: data.needsMigration };
  }
  return { ok: true, exists: true, ...data };
}
