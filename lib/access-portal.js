/**
 * Access portal tokens — email links for request status and password setup.
 */

const crypto = require('crypto');

const PORTAL_PREFIX = 'ros_portal_';

function hashPortalToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generatePortalToken() {
  return PORTAL_PREFIX + crypto.randomBytes(32).toString('hex');
}

function isPortalToken(token) {
  return typeof token === 'string' && token.startsWith(PORTAL_PREFIX);
}

/** Public app origin for links in email (Netlify or local). */
function getAppPublicOrigin(req) {
  const fromEnv = (process.env.APP_PUBLIC_ORIGIN || process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const origin = (req?.headers?.origin || '').trim();
  if (origin) return origin.replace(/\/$/, '');
  return 'http://localhost:3003';
}

function buildAccessPortalUrl(origin, rawToken) {
  const base = (origin || 'http://localhost:3003').replace(/\/$/, '');
  return `${base}/access?token=${encodeURIComponent(rawToken)}`;
}

function needsPasswordSetup(row) {
  if (!row || row.status !== 'approved') return false;
  if (row.password_set_at) return false;
  return !row.neon_user_id;
}

async function ensurePortalToken(pool, accessId) {
  const r = await pool.query(`SELECT portal_token FROM public.api_user_access WHERE id = $1`, [accessId]);
  const existing = String(r.rows[0]?.portal_token || '').trim();
  if (isPortalToken(existing)) return existing;
  return assignPortalToken(pool, accessId);
}

async function assignPortalToken(pool, accessId) {
  const rawToken = generatePortalToken();
  const tokenHash = hashPortalToken(rawToken);
  await pool.query(
    `UPDATE public.api_user_access SET portal_token_hash = $1, portal_token = $2 WHERE id = $3`,
    [tokenHash, rawToken, accessId]
  );
  return rawToken;
}

module.exports = {
  PORTAL_PREFIX,
  hashPortalToken,
  generatePortalToken,
  isPortalToken,
  getAppPublicOrigin,
  buildAccessPortalUrl,
  needsPasswordSetup,
  ensurePortalToken,
  assignPortalToken,
};
