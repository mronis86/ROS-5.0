import { getApiBaseUrl } from '../services/api-client';

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

export function isAdminSessionUnlocked(): boolean {
  return sessionStorage.getItem(ADMIN_UNLOCK_KEY) === '1' && !!getStoredAdminKey();
}

function buildAdminUrl(base: string, path: string, key: string): string {
  const normalizedBase = base.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${normalizedBase}${normalizedPath}`);
  url.searchParams.set('key', key);
  return url.toString();
}

export async function adminFetchWithCredentials(
  key: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const base = getApiBaseUrl();
  const url = buildAdminUrl(base, path, key);
  return fetch(url, init);
}

export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
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
  const adminKey = getStoredAdminKey();
  if (adminKey && password === adminKey) return true;
  return false;
}
