/** Optional Bearer token for offline UI (same key as hosted app when present). */
const API_TOKEN_KEY = 'ros_api_token';

export function getApiAccessToken(): string | null {
  try {
    return localStorage.getItem(API_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function authHeaders(): Record<string, string> {
  const token = getApiAccessToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/** JSON API requests — includes session/integration token when available. */
export function apiJsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'Content-Type': 'application/json', ...authHeaders(), ...extra };
}
