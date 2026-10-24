/**
 * VDO.Ninja view URLs only — ROS stores the link; the helper mints push rooms.
 */

function sanitizeVdoViewUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  let u;
  try {
    u = new URL(s);
  } catch {
    return '';
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:') return '';
  if (host !== 'vdo.ninja' && host !== 'www.vdo.ninja') return '';
  if (!u.searchParams.get('view') && !u.searchParams.get('scene')) return '';
  return u.toString();
}

function normalizeLiveCaptureSource(value) {
  return String(value || '').trim().toLowerCase() === 'camera' ? 'camera' : 'screen';
}

module.exports = { sanitizeVdoViewUrl, normalizeLiveCaptureSource };
