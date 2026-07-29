const { normalizeBaseUrl } = require('./auth-session');

async function railwayFetch(apiBaseUrl, apiToken, pathname, options = {}) {
  const base = normalizeBaseUrl(apiBaseUrl);
  if (!base) throw new Error('API base URL is required');
  const url = `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };
  const token = String(apiToken || '').trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      (body && typeof body === 'object' && (body.message || body.error)) ||
      `HTTP ${res.status}`;
    const err = new Error(String(msg));
    err.status = res.status;
    err.body = body;
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
  try {
    const health = await fetch(`${base}/health`);
    if (!health.ok) {
      return { ok: false, message: `Health check failed (${health.status})` };
    }
  } catch (err) {
    return { ok: false, message: err.message || 'Cannot reach API' };
  }

  if (!String(apiToken || '').trim()) {
    return {
      ok: true,
      warning: true,
      message: 'API reachable, but no token set — protected routes will 401 when auth is required.',
    };
  }

  try {
    await listCalendarEvents(apiBaseUrl, apiToken);
    return { ok: true, message: 'API + token OK (calendar-events)' };
  } catch (err) {
    return {
      ok: false,
      message: err.message || 'Token validation failed',
      status: err.status,
    };
  }
}

module.exports = {
  railwayFetch,
  listCalendarEvents,
  getRunOfShowData,
  getActiveTimer,
  validateApi,
};
