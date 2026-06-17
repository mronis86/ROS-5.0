import { getApiBaseUrl } from '../services/api-client';
import { authHeaders, getApiAccessToken } from './sessionAuth';

const ADMIN_KEY_STORAGE = 'ros_admin_key';
export const ADMIN_UNLOCK_KEY = 'ros_admin_unlocked';

export function getStoredAdminKey(): string | null {
  return sessionStorage.getItem(ADMIN_KEY_STORAGE);
}

export function setStoredAdminCredentials(key: string): void {
  sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
}

export function clearStoredAdminCredentials(): void {
  sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  sessionStorage.removeItem(ADMIN_UNLOCK_KEY);
}

/** Signed-in Neon user with is_admin — uses ros_nsess_* instead of shared ADMIN_KEY. */
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

export function isAdminSessionUnlocked(): boolean {
  if (canUseNeonAdminSession()) return true;
  return sessionStorage.getItem(ADMIN_UNLOCK_KEY) === '1' && !!getStoredAdminKey();
}

function buildAdminUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function mergeAdminRequestHeaders(key: string | null, init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (key) {
    headers.set('X-Admin-Key', key);
  }
  const session = authHeaders();
  if (session.Authorization) {
    headers.set('Authorization', session.Authorization);
  }
  return headers;
}

export async function fetchAdminAuthStatus(key: string): Promise<{
  adminKeyConfigured?: boolean;
  expectedKeyLength?: number;
  receivedKeyLength?: number;
  keyMatches?: boolean;
}> {
  const base = getApiBaseUrl();
  const res = await fetch(buildAdminUrl(base, '/api/admin/auth-status'), {
    headers: { 'X-Admin-Key': key },
  });
  return res.json().catch(() => ({}));
}

export function describeAdminAuthFailure(
  status: Awaited<ReturnType<typeof fetchAdminAuthStatus>>,
  _reason?: string
): string {
  if (!status.adminKeyConfigured) {
    return 'ADMIN_KEY is not set on Railway. Add it in Railway → Variables and redeploy.';
  }
  if (!status.keyMatches) {
    return 'Invalid admin key.';
  }
  return 'Invalid admin key';
}

export async function adminFetchWithCredentials(
  key: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const base = getApiBaseUrl();
  return fetch(buildAdminUrl(base, path), {
    ...init,
    headers: mergeAdminRequestHeaders(key, init),
  });
}

export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  if (canUseNeonAdminSession()) {
    const base = getApiBaseUrl();
    return fetch(buildAdminUrl(base, path), {
      ...init,
      headers: mergeAdminRequestHeaders(null, init),
    });
  }

  const key = getStoredAdminKey();
  if (!key) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return adminFetchWithCredentials(key, path, init);
}

/** Gate for destructive Run-of-Show actions (e.g. clear change log). */
export function verifyClearLogPassword(password: string): boolean {
  const envPassword = import.meta.env.VITE_CLEAR_LOG_PASSWORD as string | undefined;
  if (envPassword && password === envPassword) return true;
  if (canUseNeonAdminSession()) return true;
  const adminKey = getStoredAdminKey();
  if (adminKey && password === adminKey) return true;
  return false;
}
