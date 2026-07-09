const { session } = require('electron');

const state = {
  apiOrigin: '',
  token: '',
  installed: false,
};

function normalizeBaseUrl(url) {
  let s = String(url || '').trim();
  if (!s) return '';
  // Fix common typo: http:/host → http://host
  s = s.replace(/^(https?):\/(?!\/)/i, '$1://');
  if (!/^https?:\/\//i.test(s)) {
    s = /localhost|127\.0\.0\.1/i.test(s) ? `http://${s}` : `https://${s}`;
  }
  return s.replace(/\/$/, '');
}

function apiUrlPattern(apiBaseUrl) {
  const base = normalizeBaseUrl(apiBaseUrl);
  if (!base) return '';
  try {
    const { origin } = new URL(base);
    return `${origin}/api/*`;
  } catch {
    return '';
  }
}

function getApiOrigin(apiBaseUrl) {
  const base = normalizeBaseUrl(apiBaseUrl);
  try {
    return new URL(base).origin;
  } catch {
    return '';
  }
}

function installApiAuth(sessionInstance, apiBaseUrl, apiToken) {
  state.apiOrigin = getApiOrigin(apiBaseUrl);
  state.token = String(apiToken || '').trim();

  if (state.installed) return !!state.token && !!state.apiOrigin;

  sessionInstance.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const headers = { ...details.requestHeaders };
    if (
      state.token &&
      state.apiOrigin &&
      details.url.startsWith(state.apiOrigin) &&
      details.url.includes('/api/')
    ) {
      headers.Authorization = `Bearer ${state.token}`;
    }
    callback({ requestHeaders: headers });
  });

  state.installed = true;
  return !!state.token && !!state.apiOrigin;
}

module.exports = { installApiAuth, normalizeBaseUrl, apiUrlPattern };
