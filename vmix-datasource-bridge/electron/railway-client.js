const { normalizeBaseUrl, normalizeApiToken } = require('./auth-session');

const INTEGRATION_PREFIX = 'ros_itok_';

/**
 * Use Electron's Chromium network stack when available so Windows/corporate
 * root CAs are trusted (Node undici fetch often fails with "unable to get local issuer certificate").
 */
async function httpFetch(url, options = {}) {
  try {
    const { net } = require('electron');
    if (net && typeof net.fetch === 'function') {
      return net.fetch(url, options);
    }
  } catch {
    /* not in Electron / net unavailable */
  }
  return fetch(url, options);
}

function authErrorMessage(status, body) {
  const detail =
    body && typeof body === 'object'
      ? body.message || body.error || null
      : typeof body === 'string' && body && !body.includes('<!DOCTYPE')
        ? body.slice(0, 200)
        : null;

  if (status === 401) {
    return (
      detail ||
      'Unauthorized — use an Integration token from Admin → Integration tokens (must start with ros_itok_).'
    );
  }
  if (status === 403) {
    return (
      detail ||
      'Forbidden — token needs at least the read scope (Admin → Integration tokens).'
    );
  }
  if (detail) return String(detail);
  return `HTTP ${status}`;
}

async function railwayFetch(apiBaseUrl, apiToken, pathname, options = {}) {
  const base = normalizeBaseUrl(apiBaseUrl);
  if (!base) throw new Error('API base URL is required');
  const url = `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };
  const token = normalizeApiToken(apiToken);
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await httpFetch(url, { ...options, headers });
  } catch (err) {
    const msg = err.message || String(err);
    if (/certificate|SSL|TLS|UNABLE_TO_VERIFY|issuer/i.test(msg)) {
      const e = new Error(
        `TLS/SSL error reaching API (${msg}). The packaged app now uses Electron net.fetch — re-copy the latest READY zip if you still see this.`
      );
      e.cause = err;
      throw e;
    }
    const e = new Error(`Cannot reach API: ${msg}`);
    e.cause = err;
    throw e;
  }

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new Error(authErrorMessage(res.status, body));
    err.status = res.status;
    err.body = body;
    err.url = url;
    throw err;
  }
  return body;
}

async function listCalendarEvents(apiBaseUrl, apiToken) {
  const data = await railwayFetch(apiBaseUrl, apiToken, '/api/calendar-events');
  return Array.isArray(data) ? data : data?.value || data?.events || [];
}

async function getRunOfShowData(apiBaseUrl, apiToken, eventId) {
  return railwayFetch(apiBaseUrl, apiToken, `/api/run-of-show-data/${encodeURIComponent(eventId)}`);
}

async function getActiveTimer(apiBaseUrl, apiToken, eventId) {
  const data = await railwayFetch(
    apiBaseUrl,
    apiToken,
    `/api/active-timers/${encodeURIComponent(eventId)}`
  );
  const rows = Array.isArray(data) ? data : data?.value || [];
  return rows.length > 0 ? rows[0] : null;
}

async function validateApi(apiBaseUrl, apiToken) {
  const base = normalizeBaseUrl(apiBaseUrl);
  if (!base) {
    return { ok: false, message: 'API base URL is required (e.g. https://ros-50-production.up.railway.app)' };
  }

  const token = normalizeApiToken(apiToken);

  try {
    const health = await httpFetch(`${base}/health`);
    if (!health.ok) {
      return { ok: false, message: `Health check failed (${health.status}) at ${base}/health` };
    }
  } catch (err) {
    const msg = err.message || 'Cannot reach API';
    return {
      ok: false,
      message: /certificate|SSL|TLS|issuer/i.test(msg)
        ? `TLS/SSL error reaching ${base} — ${msg}`
        : `Cannot reach API at ${base} — ${msg}`,
    };
  }

  if (!token) {
    return {
      ok: true,
      warning: true,
      message: 'API reachable, but no token set — protected routes will 401 when auth is required.',
    };
  }

  if (!token.startsWith(INTEGRATION_PREFIX) && !token.startsWith('ros_sess_') && !token.startsWith('ros_nsess_')) {
    return {
      ok: false,
      message:
        `Token does not look like an Integration token (expected prefix ${INTEGRATION_PREFIX}). ` +
        'Create one in Admin → Integration tokens with scope read, and paste the full token once (not the name).',
    };
  }

  try {
    const events = await listCalendarEvents(apiBaseUrl, token);
    const n = Array.isArray(events) ? events.length : 0;
    return {
      ok: true,
      message: `API + token OK — loaded ${n} calendar event(s)`,
      eventCount: n,
    };
  } catch (err) {
    return {
      ok: false,
      message: err.message || 'Token validation failed',
      status: err.status,
      url: err.url,
    };
  }
}

module.exports = {
  railwayFetch,
  listCalendarEvents,
  getRunOfShowData,
  getActiveTimer,
  validateApi,
  normalizeApiToken,
  httpFetch,
};
