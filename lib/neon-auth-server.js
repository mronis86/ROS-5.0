/**
 * Validate Neon Auth JWTs on the Railway API (cross-domain from Netlify frontend).
 * Set NEON_AUTH_BASE_URL to the Auth URL from Neon Console (same as VITE_NEON_AUTH_URL).
 */

let cachedJwks = null;
let cachedIssuer = null;
let josePromise = null;

function isNeonAuthConfigured() {
  return Boolean((process.env.NEON_AUTH_BASE_URL || '').trim());
}

function getNeonAuthBaseUrl() {
  return (process.env.NEON_AUTH_BASE_URL || '').trim().replace(/\/$/, '');
}

function isLikelyJwt(token) {
  return typeof token === 'string' && token.split('.').length === 3;
}

async function loadJose() {
  if (!josePromise) {
    josePromise = import('jose');
  }
  return josePromise;
}

async function getJwks() {
  const base = getNeonAuthBaseUrl();
  if (!base) return null;
  const { createRemoteJWKSet } = await loadJose();
  if (!cachedJwks) {
    cachedJwks = createRemoteJWKSet(new URL(`${base}/.well-known/jwks.json`));
    cachedIssuer = new URL(base).origin;
  }
  return { jwks: cachedJwks, issuer: cachedIssuer };
}

async function validateNeonSessionViaApi(token) {
  const base = getNeonAuthBaseUrl();
  if (!base || !token) return null;
  try {
    const res = await fetch(`${base}/get-session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const user = body?.user;
    if (!user?.id) return null;
    return {
      sub: String(user.id),
      id: String(user.id),
      email: user.email,
      name: user.name,
    };
  } catch {
    return null;
  }
}

async function validateNeonAuthToken(token) {
  if (!token || token.startsWith('ros_sess_') || token.startsWith('ros_itok_')) {
    return null;
  }

  if (isLikelyJwt(token)) {
    const cfg = await getJwks();
    if (cfg) {
      try {
        const { jwtVerify } = await loadJose();
        const { payload } = await jwtVerify(token, cfg.jwks, {
          issuer: cfg.issuer,
        });
        return payload;
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[neon-auth] JWT verify failed:', err.message);
        }
      }
    }
  }

  return validateNeonSessionViaApi(token);
}

module.exports = {
  isNeonAuthConfigured,
  getNeonAuthBaseUrl,
  validateNeonAuthToken,
};
