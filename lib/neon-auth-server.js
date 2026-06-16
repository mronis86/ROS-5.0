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

async function verifyNeonJwt(token) {
  if (!isLikelyJwt(token)) return null;
  const cfg = await getJwks();
  if (!cfg) return null;
  try {
    const { jwtVerify } = await loadJose();
    try {
      const { payload } = await jwtVerify(token, cfg.jwks, {
        issuer: cfg.issuer,
        audience: cfg.issuer,
        clockTolerance: 60,
      });
      return payload;
    } catch {
      const { payload } = await jwtVerify(token, cfg.jwks, {
        issuer: cfg.issuer,
        clockTolerance: 60,
      });
      return payload;
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[neon-auth] JWT verify failed:', err.message);
    }
    return null;
  }
}

/** Exchange opaque session token for JWT via Neon Auth /token (Better Auth bearer plugin). */
async function fetchNeonJwtFromSessionToken(sessionToken) {
  const base = getNeonAuthBaseUrl();
  if (!base || !sessionToken || isLikelyJwt(sessionToken)) return null;
  try {
    const res = await fetch(`${base}/token`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const jwt = data?.token;
    return typeof jwt === 'string' && isLikelyJwt(jwt) ? jwt : null;
  } catch {
    return null;
  }
}

async function validateNeonSessionViaApi(token) {
  if (!token || isLikelyJwt(token)) return null;

  const base = getNeonAuthBaseUrl();
  if (!base) return null;

  const parseSessionUser = (body) => {
    const user = body?.user;
    if (!user?.id) return null;
    return {
      sub: String(user.id),
      id: String(user.id),
      email: user.email,
      name: user.name,
    };
  };

  const tryFetch = async (headers) => {
    const res = await fetch(`${base}/get-session`, { headers });
    if (!res.ok) return null;
    const body = await res.json();
    return parseSessionUser(body);
  };

  const headerSets = [
    { Authorization: `Bearer ${token}` },
    { Cookie: `better-auth.session_token=${token}` },
    { Cookie: `__Secure-better-auth.session_token=${token}` },
  ];

  for (const headers of headerSets) {
    try {
      const payload = await tryFetch(headers);
      if (payload) return payload;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function resolveNeonIdentity(rawToken, extraToken, bodyJwt) {
  const jwtCandidates = [bodyJwt, rawToken, extraToken].filter(
    (t) => typeof t === 'string' && t.trim() && isLikelyJwt(t)
  );
  for (const jwt of jwtCandidates) {
    const payload = await verifyNeonJwt(jwt);
    if (payload && (payload.sub || payload.id)) return payload;
  }

  const sessionCandidates = [rawToken, extraToken].filter(
    (t) => typeof t === 'string' && t.trim() && !isLikelyJwt(t)
  );
  for (const sessionToken of sessionCandidates) {
    const jwtFromTokenEndpoint = await fetchNeonJwtFromSessionToken(sessionToken);
    if (jwtFromTokenEndpoint) {
      const payload = await verifyNeonJwt(jwtFromTokenEndpoint);
      if (payload && (payload.sub || payload.id)) return payload;
    }
    const payload = await validateNeonSessionViaApi(sessionToken);
    if (payload) return payload;
  }

  return null;
}

async function validateNeonAuthToken(token) {
  if (!token || token.startsWith('ros_sess_') || token.startsWith('ros_itok_') || token.startsWith('ros_nsess_')) {
    return null;
  }
  if (isLikelyJwt(token)) {
    return verifyNeonJwt(token);
  }
  const jwtFromTokenEndpoint = await fetchNeonJwtFromSessionToken(token);
  if (jwtFromTokenEndpoint) {
    const payload = await verifyNeonJwt(jwtFromTokenEndpoint);
    if (payload) return payload;
  }
  return validateNeonSessionViaApi(token);
}

module.exports = {
  isNeonAuthConfigured,
  getNeonAuthBaseUrl,
  validateNeonAuthToken,
  resolveNeonIdentity,
  isLikelyJwt,
};
