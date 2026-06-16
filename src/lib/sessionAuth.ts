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
