/**
 * Admin API authentication. Key from ADMIN_KEY env.
 * Accepts credentials via X-Admin-Key header, Authorization: Bearer, or ?key= query (legacy).
 */

const crypto = require('crypto');

function timingSafeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function loadAdminAuthConfig(isProduction) {
  const adminKey = (process.env.ADMIN_KEY || '').trim();

  if (!adminKey) {
    if (isProduction) {
      console.error('FATAL: ADMIN_KEY must be set in production. Admin endpoints are disabled until configured.');
      process.exit(1);
    }
    console.warn('WARNING: ADMIN_KEY is not set. All admin API requests will be rejected.');
  } else if (adminKey === '1615') {
    console.warn('WARNING: ADMIN_KEY is still set to the compromised default "1615". Rotate immediately.');
  }

  console.log(`[admin-auth] ADMIN_KEY length ${adminKey.length}`);

  return { adminKey };
}

function getAdminKeyFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const headerKey = req.headers['x-admin-key'];
  if (typeof headerKey === 'string' && headerKey) return headerKey.trim();
  if (typeof req.query.key === 'string') return req.query.key.trim();
  return '';
}

function createRequireAdminAuth(adminKey) {
  return function requireAdminAuth(req, res) {
    if (!adminKey) {
      res.status(503).json({ error: 'Admin API not configured' });
      return false;
    }
    const key = getAdminKeyFromRequest(req);
    if (!timingSafeStringEqual(key, adminKey)) {
      res.status(401).json({ error: 'Unauthorized', reason: 'key_mismatch' });
      return false;
    }
    return true;
  };
}

/** Safe diagnostic: lengths and match flag only — never returns the secret. */
function createAdminAuthStatus(adminKey) {
  return function adminAuthStatus(req, res) {
    const receivedKey = getAdminKeyFromRequest(req);
    const keyMatches = adminKey.length > 0 && timingSafeStringEqual(receivedKey, adminKey);
    res.json({
      adminKeyConfigured: adminKey.length > 0,
      expectedKeyLength: adminKey.length,
      receivedKeyLength: receivedKey.length,
      keyMatches,
    });
  };
}

module.exports = {
  loadAdminAuthConfig,
  createRequireAdminAuth,
  createAdminAuthStatus,
};
