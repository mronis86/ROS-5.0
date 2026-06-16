/**
 * Validate Neon Auth JWTs on the Railway API (cross-domain from Netlify frontend).
 * Set NEON_AUTH_BASE_URL to the Auth URL from Neon Console (same as VITE_NEON_AUTH_URL).
 */

const { jwtVerify, createRemoteJWKSet } = require('jose');

let cachedJwks = null;
let cachedIssuer = null;

function isNeonAuthConfigured() {
  return Boolean((process.env.NEON_AUTH_BASE_URL || '').trim());
}

function getNeonAuthBaseUrl() {
  return (process.env.NEON_AUTH_BASE_URL || '').trim().replace(/\/$/, '');
}

function getJwks() {
  const base = getNeonAuthBaseUrl();
  if (!base) return null;
  if (!cachedJwks) {
    cachedJwks = createRemoteJWKSet(new URL(`${base}/.well-known/jwks.json`));
    cachedIssuer = new URL(base).origin;
  }
  return { jwks: cachedJwks, issuer: cachedIssuer };
}

async function validateNeonAuthToken(token) {
  if (!token || token.startsWith('ros_sess_') || token.startsWith('ros_itok_')) {
    return null;
  }
  const cfg = getJwks();
  if (!cfg) return null;
  try {
    const { payload } = await jwtVerify(token, cfg.jwks, {
      issuer: cfg.issuer,
      audience: cfg.issuer,
    });
    return payload;
  } catch (err) {
    return null;
  }
}

module.exports = {
  isNeonAuthConfigured,
  getNeonAuthBaseUrl,
  validateNeonAuthToken,
};
