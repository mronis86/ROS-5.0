const { normalizeBaseUrl, normalizeApiToken } = require('./auth-session');

const INTEGRATION_PREFIX = 'ros_itok_';

async function httpFetch(url, options = {}) {
  try {
    const { net } = require('electron');
    if (net && typeof net.fetch === 'function') {
      return net.fetch(url, options);
    }
  } catch {
    /* not in Electron */
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
      'Unauthorized — use an Integration token from Admin → Integration tokens (ros_itok_…).'
    );
  }
  if (status === 403) {
    return detail || 'Forbidden — token needs read, control, and write scopes.';
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
    throw new Error(`Cannot reach API: ${err.message || err}`);
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
    throw err;
  }
  return body;
}

async function listCalendarEvents(apiBaseUrl, apiToken) {
  const data = await railwayFetch(apiBaseUrl, apiToken, '/api/calendar-events');
  return Array.isArray(data) ? data : data?.value || data?.events || [];
}

async function validateApi(apiBaseUrl, apiToken) {
  const base = normalizeBaseUrl(apiBaseUrl);
  if (!base) return { ok: false, message: 'API base URL is required' };
  const token = normalizeApiToken(apiToken);
  try {
    const health = await httpFetch(`${base}/health`);
    if (!health.ok) return { ok: false, message: `Health check failed (${health.status})` };
  } catch (err) {
    return { ok: false, message: `Cannot reach API at ${base} — ${err.message}` };
  }
  if (!token) {
    return { ok: true, warning: true, message: 'API reachable, but no token set.' };
  }
  if (!token.startsWith(INTEGRATION_PREFIX) && !token.startsWith('ros_sess_') && !token.startsWith('ros_nsess_')) {
    return {
      ok: false,
      message: `Token should start with ${INTEGRATION_PREFIX} (Admin → Integration tokens).`,
    };
  }
  try {
    const events = await listCalendarEvents(apiBaseUrl, token);
    return {
      ok: true,
      message: `API + token OK — loaded ${events.length} calendar event(s)`,
      eventCount: events.length,
    };
  } catch (err) {
    return { ok: false, message: err.message || 'Token validation failed' };
  }
}

async function uploadStills(apiBaseUrl, apiToken, eventId, payload) {
  return railwayFetch(apiBaseUrl, apiToken, `/api/powerpoint/${encodeURIComponent(eventId)}/stills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function reportLive(apiBaseUrl, apiToken, eventId, payload) {
  return railwayFetch(apiBaseUrl, apiToken, `/api/powerpoint/${encodeURIComponent(eventId)}/live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function fetchPlaybackManifest(apiBaseUrl, apiToken, eventId) {
  return railwayFetch(
    apiBaseUrl,
    apiToken,
    `/api/powerpoint/${encodeURIComponent(eventId)}/playback/manifest`
  );
}

async function fetchPlaybackStatus(apiBaseUrl, apiToken, eventId) {
  return railwayFetch(apiBaseUrl, apiToken, `/api/powerpoint/${encodeURIComponent(eventId)}/playback`);
}

async function fetchPlaybackAsset(apiBaseUrl, apiToken, eventId, fileId) {
  return railwayFetch(
    apiBaseUrl,
    apiToken,
    `/api/powerpoint/${encodeURIComponent(eventId)}/playback/asset/${encodeURIComponent(fileId)}`
  );
}

async function reportPlaybackLive(apiBaseUrl, apiToken, eventId, payload) {
  return railwayFetch(
    apiBaseUrl,
    apiToken,
    `/api/powerpoint/${encodeURIComponent(eventId)}/playback/live`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
}

async function reportLiveCapture(apiBaseUrl, apiToken, eventId, payload) {
  return railwayFetch(
    apiBaseUrl,
    apiToken,
    `/api/powerpoint/${encodeURIComponent(eventId)}/playback/live-capture`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
}

async function uploadPlaybackPreviews(apiBaseUrl, apiToken, eventId, payload) {
  return railwayFetch(
    apiBaseUrl,
    apiToken,
    `/api/powerpoint/${encodeURIComponent(eventId)}/playback/previews`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
}

async function fetchPlaybackPreviews(apiBaseUrl, apiToken, eventId, fileId) {
  const qs = fileId ? `?fileId=${encodeURIComponent(String(fileId))}` : '';
  return railwayFetch(
    apiBaseUrl,
    apiToken,
    `/api/powerpoint/${encodeURIComponent(eventId)}/playback/previews${qs}`
  );
}

async function fetchPlaybackPreviewImage(apiBaseUrl, apiToken, eventId, slideId) {
  const base = normalizeBaseUrl(apiBaseUrl);
  if (!base) throw new Error('API base URL is required');
  const url = `${base}/api/powerpoint/${encodeURIComponent(eventId)}/playback/previews/${encodeURIComponent(String(slideId))}/image`;
  const headers = { Accept: 'image/jpeg,image/*,*/*' };
  const token = normalizeApiToken(apiToken);
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await httpFetch(url, { headers });
  } catch (err) {
    throw new Error(`Cannot reach API: ${err.message || err}`);
  }
  if (!res.ok) {
    throw new Error(authErrorMessage(res.status, null));
  }
  return Buffer.from(await res.arrayBuffer());
}

module.exports = {
  railwayFetch,
  httpFetch,
  listCalendarEvents,
  validateApi,
  uploadStills,
  reportLive,
  fetchPlaybackManifest,
  fetchPlaybackStatus,
  fetchPlaybackAsset,
  reportPlaybackLive,
  reportLiveCapture,
  uploadPlaybackPreviews,
  fetchPlaybackPreviews,
  fetchPlaybackPreviewImage,
};
