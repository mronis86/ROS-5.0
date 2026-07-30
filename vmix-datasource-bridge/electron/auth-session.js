function normalizeBaseUrl(url) {
  let s = String(url || '').trim();
  if (!s) return '';
  s = s.replace(/^(https?):\/(?!\/)/i, '$1://');
  if (!/^https?:\/\//i.test(s)) {
    s = /localhost|127\.0\.0\.1/i.test(s) ? `http://${s}` : `https://${s}`;
  }
  // Strip trailing slash and accidental /api suffix (avoids /api/api/...)
  s = s.replace(/\/+$/, '');
  s = s.replace(/\/api$/i, '');
  return s;
}

/** Integration tokens are ros_itok_… — strip pasted "Bearer ", quotes, whitespace. */
function normalizeApiToken(token) {
  let t = String(token || '').trim();
  if (!t) return '';
  t = t.replace(/^Bearer\s+/i, '').trim();
  t = t.replace(/^["']|["']$/g, '').trim();
  // Collapse accidental newlines from rich-text paste
  t = t.replace(/\s+/g, '');
  return t;
}

function getApiOrigin(apiBaseUrl) {
  const base = normalizeBaseUrl(apiBaseUrl);
  try {
    return new URL(base).origin;
  } catch {
    return '';
  }
}

/**
 * Attach Bearer token to Railway /api/* requests from the renderer session.
 */
function installApiAuth(sessionInstance, apiBaseUrl, apiToken) {
  const state = {
    apiOrigin: getApiOrigin(apiBaseUrl),
    token: normalizeApiToken(apiToken),
  };

  if (!sessionInstance.__rosVmixAuthInstalled) {
    sessionInstance.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
      const headers = { ...details.requestHeaders };
      const cfg = sessionInstance.__rosVmixAuthState || state;
      if (
        cfg.token &&
        cfg.apiOrigin &&
        details.url.startsWith(cfg.apiOrigin) &&
        details.url.includes('/api/')
      ) {
        headers.Authorization = `Bearer ${cfg.token}`;
      }
      callback({ requestHeaders: headers });
    });
    sessionInstance.__rosVmixAuthInstalled = true;
  }

  sessionInstance.__rosVmixAuthState = state;
  return !!state.token && !!state.apiOrigin;
}

module.exports = {
  installApiAuth,
  normalizeBaseUrl,
  normalizeApiToken,
  getApiOrigin,
};
