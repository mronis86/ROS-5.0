function normalizeBaseUrl(url) {
  let s = String(url || '').trim();
  if (!s) return '';
  s = s.replace(/^(https?):\/(?!\/)/i, '$1://');
  if (!/^https?:\/\//i.test(s)) {
    s = /localhost|127\.0\.0\.1/i.test(s) ? `http://${s}` : `https://${s}`;
  }
  s = s.replace(/\/+$/, '');
  s = s.replace(/\/api$/i, '');
  return s;
}

function normalizeApiToken(token) {
  let t = String(token || '').trim();
  if (!t) return '';
  t = t.replace(/^Bearer\s+/i, '').trim();
  t = t.replace(/^["']|["']$/g, '').trim();
  t = t.replace(/\s+/g, '');
  return t;
}

module.exports = { normalizeBaseUrl, normalizeApiToken };
