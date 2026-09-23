const API_TOKEN_KEY = 'ros_api_token';

/** After a 401, pause authenticated fetches so expired display tabs don't spam ops alerts. */
let authBackoffUntil = 0;

export function getApiAccessToken(): string | null {
  return localStorage.getItem(API_TOKEN_KEY);
}

export function setApiAccessToken(token: string | null): void {
  if (token) {
    localStorage.setItem(API_TOKEN_KEY, token);
    authBackoffUntil = 0;
  } else {
    localStorage.removeItem(API_TOKEN_KEY);
  }
}

export function authHeaders(): Record<string, string> {
  const token = getApiAccessToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/** JSON API requests from the signed-in web app (includes ros_nsess / legacy session token). */
export function apiJsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'Content-Type': 'application/json', ...authHeaders(), ...extra };
}

/**
 * Authenticated JSON fetch for protected Railway routes.
 * Skips the network call when there is no session token so we do not generate
 * 401 spam (and ops "unauthorized API" emails) from display tabs without login.
 * Also backs off briefly after a 401 (expired session still present in storage).
 */
export async function apiAuthFetch(url: string, init: RequestInit = {}): Promise<Response | null> {
  if (!getApiAccessToken()) return null;
  if (Date.now() < authBackoffUntil) return null;
  const headers = new Headers(init.headers || {});
  const auth = authHeaders();
  Object.entries(auth).forEach(([k, v]) => headers.set(k, v));
  if (!headers.has('Content-Type') && init.body != null) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    authBackoffUntil = Date.now() + 2 * 60 * 1000;
  }
  return res;
}
