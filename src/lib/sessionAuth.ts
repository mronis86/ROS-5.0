const API_TOKEN_KEY = 'ros_api_token';

/**
 * After a 401/429 stopPolling response, clear the stored session so display/OBS
 * tabs stop hammering Railway (apiAuthFetch no-ops without a token).
 */
let authDead = false;

export function getApiAccessToken(): string | null {
  if (authDead) return null;
  return localStorage.getItem(API_TOKEN_KEY);
}

export function setApiAccessToken(token: string | null): void {
  if (token) {
    localStorage.setItem(API_TOKEN_KEY, token);
    authDead = false;
  } else {
    localStorage.removeItem(API_TOKEN_KEY);
  }
}

/** Mark session unusable — clears token and blocks further authenticated fetches. */
export function clearApiAccessTokenOnAuthFailure(reason?: string): void {
  authDead = true;
  try {
    localStorage.removeItem(API_TOKEN_KEY);
  } catch {
    /* ignore */
  }
  if (reason) {
    console.warn('[sessionAuth] Cleared API token after auth failure:', reason);
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

function shouldStopPolling(res: Response, body?: { stopPolling?: boolean } | null): boolean {
  if (body?.stopPolling === true) return true;
  if (res.status === 401) return true;
  if (res.status === 429 && res.headers.get('Retry-After')) return true;
  return false;
}

/**
 * Authenticated JSON fetch for protected Railway routes.
 * Skips the network call when there is no session token so we do not generate
 * 401 spam (and ops "unauthorized API" emails) from display tabs without login.
 * On 401 / stopPolling, clears the token so polling stops until the user signs in again.
 */
export async function apiAuthFetch(url: string, init: RequestInit = {}): Promise<Response | null> {
  if (!getApiAccessToken()) return null;
  const headers = new Headers(init.headers || {});
  const auth = authHeaders();
  Object.entries(auth).forEach(([k, v]) => headers.set(k, v));
  if (!headers.has('Content-Type') && init.body != null) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 || res.status === 429) {
    let body: { stopPolling?: boolean } | null = null;
    try {
      body = await res.clone().json();
    } catch {
      /* ignore */
    }
    if (shouldStopPolling(res, body)) {
      clearApiAccessTokenOnAuthFailure(`${res.status} ${url}`);
    }
  }
  return res;
}
