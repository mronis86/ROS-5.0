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
  const detail =
    data && typeof data === 'object'
      ? data.message || data.error || null
      : typeof data === 'string' && data
        ? data
        : null;

  if (status === 403) {
    return (
      detail ||
      'Railway API token lacks permission — offline reconnect needs Integration scopes read + control + write (Admin → Integration API tokens).'
    );
  }
  if (status === 401) {
    return (
      detail ||
      'Railway API rejected the token — add a valid Integration API token (Admin → Integration API tokens, scopes read + control + write).'
    );
  }
  if (detail) return detail;
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

/**
 * Probe whether a token can write schedule data.
 * Empty POST → 400 (authorized, missing event_id) means write OK;
 * 401/403 means missing/invalid token or missing `write` scope.
 * GET /calendar-events alone is not enough when REQUIRE_API_AUTH=writes
 * because reads may be public.
 */
async function probeRailwayTokenWriteAccess(token) {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (!trimmed) {
    return { ok: false, canWrite: false, error: 'Token is empty' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${RAILWAY_BASE_URL}/api/run-of-show-data`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trimmed}`,
      },
      body: '{}',
      signal: controller.signal,
    });
    if (res.status === 401) {
      return {
        ok: false,
        canWrite: false,
        error:
          'Invalid or expired token — paste a valid Integration API token (Admin → Integration API tokens).',
      };
    }
    if (res.status === 403) {
      return {
        ok: false,
        canWrite: false,
        error:
          'Token lacks write permission — create one with scopes read + control + write (Admin → Integration API tokens).',
      };
    }
    // 400 = auth passed, body validation failed (expected for empty payload)
    if (res.status === 400 || res.ok) {
      return { ok: true, canWrite: true, error: null };
    }
    return {
      ok: false,
      canWrite: false,
      error: `Railway rejected token (HTTP ${res.status})`,
    };
  } catch (e) {
    return {
      ok: false,
      canWrite: false,
      error: e instanceof Error ? e.message : 'Could not reach Railway',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Quick check before saving a token in offline-show settings (requires write). */
async function validateRailwayApiToken(token) {
  const result = await probeRailwayTokenWriteAccess(token);
  if (!result.ok) {
    return { ok: false, error: result.error || 'Token validation failed' };
  }
  return { ok: true };
}

module.exports = {
  RAILWAY_BASE_URL,
  configureRailwayClient,
  getRailwayAuthHeaders,
  railwayFetch,
  railwayRequest,
  validateRailwayApiToken,
  probeRailwayTokenWriteAccess,
};
