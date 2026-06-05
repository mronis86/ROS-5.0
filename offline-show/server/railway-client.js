'use strict';

const RAILWAY_BASE_URL =
  process.env.OFFLINE_RAILWAY_URL || 'https://ros-50-production.up.railway.app';
const TIMEOUT_MS = Number(process.env.OFFLINE_RAILWAY_TIMEOUT_MS || 30000);

async function railwayFetch(method, pathWithQuery, body) {
  const url = `${RAILWAY_BASE_URL}${pathWithQuery}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const hasBody = body != null && !['GET', 'HEAD'].includes(method);
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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
      let msg =
        (data && typeof data === 'object' && data.error) ||
        (typeof data === 'string' ? data : `Railway HTTP ${res.status}`);
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

module.exports = {
  RAILWAY_BASE_URL,
  railwayFetch,
  railwayRequest,
};
