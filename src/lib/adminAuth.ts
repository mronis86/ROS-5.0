import { getApiBaseUrl } from '../services/api-client';
import { authHeaders, getApiAccessToken } from './sessionAuth';

const ADMIN_KEY_STORAGE = 'ros_admin_key';

/** Signed-in Neon user with is_admin — required for Admin page API calls. */
export function canUseNeonAdminSession(): boolean {
  const token = getApiAccessToken();
  if (!token?.startsWith('ros_nsess_')) return false;
  try {
    const stored = localStorage.getItem('ros_user_session');
    if (!stored) return false;
    const parsed = JSON.parse(stored) as { user?: { is_admin?: boolean } };
    return parsed.user?.is_admin === true;
  } catch {
    return false;
  }
}

function buildAdminUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function neonAdminHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  const session = authHeaders();
  if (session.Authorization) {
    headers.set('Authorization', session.Authorization);
  }
  return headers;
}

/** Admin API calls — Neon is_admin session only (Admin page). */
export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!canUseNeonAdminSession()) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const base = getApiBaseUrl();
  return fetch(buildAdminUrl(base, path), {
    ...init,
    headers: neonAdminHeaders(init),
  });
}

/** Gate for destructive Run-of-Show actions (e.g. clear change log). */
export function verifyClearLogPassword(_password: string): boolean {
  const envPassword = import.meta.env.VITE_CLEAR_LOG_PASSWORD as string | undefined;
  if (envPassword && _password === envPassword) return true;
  if (canUseNeonAdminSession()) return true;
  const legacyKey = sessionStorage.getItem(ADMIN_KEY_STORAGE);
  if (legacyKey && _password === legacyKey) return true;
  return false;
}
