'use strict';

const RAILWAY_BASE_URL =
  process.env.OFFLINE_RAILWAY_URL || 'https://ros-50-production.up.railway.app';
const TIMEOUT_MS = Number(process.env.OFFLINE_RAILWAY_TIMEOUT_MS || 30000);

let getTokenFn = () => (process.env.OFFLINE_RAILWAY_API_TOKEN || '').trim() || null;

function configureRailwayClient({ getToken }) {
  if (typeof getToken === 'function') {
    getTokenFn = getToken;
  }
}

function getRailwayAuthHeaders() {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const token = getTokenFn();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function authErrorMessage(status, data) {
  if (status === 401 || status === 403) {
    return 'Railway API rejected the token — add a valid Integration API token (Admin → Integration API tokens, scopes read + control).';
  }
  if (data && typeof data === 'object' && data.error) return data.error;
  if (typeof data === 'string' && data) return data;
  return `Railway HTTP ${status}`;
}

async function railwayFetch(method, pathWithQuery, body) {
  const url = `${RAILWAY_BASE_URL}${pathWithQuery}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const hasBody = body != null && !['GET', 'HEAD'].includes(method);
    const res = await fetch(url, {
      method,
      headers: getRailwayAuthHeaders(),
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      let msg = authErrorMessage(res.status, data);
      if (typeof msg === 'string' && (msg.includes('<!DOCTYPE') || msg.includes('<html'))) {
        const pre = msg.match(/<pre>([^<]+)/i);
        msg = pre ? pre[1].trim() : `Railway HTTP ${res.status}`;
      }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return { status: res.status, data, noContent: res.status === 204 || text === '' };
  } finally {
    clearTimeout(timer);
  }
}

/** Legacy helper — returns parsed body only */
async function railwayRequest(method, path, body) {
  const result = await railwayFetch(method, path, body);
  return result.data;
}

/** Quick check before saving a token in offline-show settings. */
async function validateRailwayApiToken(token) {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (!trimmed) {
    return { ok: false, error: 'Token is empty' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${RAILWAY_BASE_URL}/api/calendar-events`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${trimmed}`,
      },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Invalid or expired token' };
    }
    if (!res.ok) {
      return { ok: false, error: `Railway rejected token (HTTP ${res.status})` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not reach Railway' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  RAILWAY_BASE_URL,
  configureRailwayClient,
  getRailwayAuthHeaders,
  railwayFetch,
  railwayRequest,
  validateRailwayApiToken,
};
