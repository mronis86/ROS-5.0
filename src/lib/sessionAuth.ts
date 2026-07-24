const API_TOKEN_KEY = 'ros_api_token';

export function getApiAccessToken(): string | null {
  return localStorage.getItem(API_TOKEN_KEY);
}

export function setApiAccessToken(token: string | null): void {
  if (token) {
    localStorage.setItem(API_TOKEN_KEY, token);
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
 */
export async function apiAuthFetch(url: string, init: RequestInit = {}): Promise<Response | null> {
  if (!getApiAccessToken()) return null;
  const headers = new Headers(init.headers || {});
  const auth = authHeaders();
  Object.entries(auth).forEach(([k, v]) => headers.set(k, v));
  if (!headers.has('Content-Type') && init.body != null) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...init, headers });
}
