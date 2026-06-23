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

function isNeonAuthJwt(token) {
  if (!isLikelyJwt(token)) return false;
  try {
    const headerB64 = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const padded = headerB64 + '='.repeat((4 - (headerB64.length % 4)) % 4);
    const header = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return header.alg === 'EdDSA' || header.alg === 'Ed25519';
  } catch {
    return false;
  }
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
  if (!isNeonAuthJwt(token)) return null;
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
  if (!base || !sessionToken || isNeonAuthJwt(sessionToken)) return null;
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
  if (!token || isNeonAuthJwt(token)) return null;

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

async function resolveNeonIdentity(rawToken, extraToken, bodyJwt, signedSessionToken) {
  const jwtCandidates = [bodyJwt, rawToken, extraToken].filter(
    (t) => typeof t === 'string' && t.trim() && isNeonAuthJwt(t)
  );
  for (const jwt of jwtCandidates) {
    const payload = await verifyNeonJwt(jwt);
    if (payload && (payload.sub || payload.id)) return payload;
  }

  const sessionCandidates = [signedSessionToken, rawToken, extraToken].filter(
    (t) => typeof t === 'string' && t.trim() && !isNeonAuthJwt(t)
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
  if (isNeonAuthJwt(token)) {
    return verifyNeonJwt(token);
  }
  const jwtFromTokenEndpoint = await fetchNeonJwtFromSessionToken(token);
  if (jwtFromTokenEndpoint) {
    const payload = await verifyNeonJwt(jwtFromTokenEndpoint);
    if (payload) return payload;
  }
  return validateNeonSessionViaApi(token);
}

function resolveNeonClientOrigin(originHeader, refererHeader) {
  const fromEnv = (process.env.NEON_AUTH_CLIENT_ORIGIN || '').trim();
  const origin = (originHeader || '').trim();
  if (origin) return origin;
  const referer = (refererHeader || '').trim();
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      /* ignore */
    }
  }
  return fromEnv || 'http://localhost:3003';
}

/** Origin sent to Neon Auth from Railway (server-side proxy). Node fetch cannot reliably set arbitrary Origin headers, so we use localhost (Neon default) or NEON_AUTH_CLIENT_ORIGIN — not the browser origin. */
function resolveNeonProxyOrigin() {
  const fromEnv = (process.env.NEON_AUTH_CLIENT_ORIGIN || '').trim();
  return fromEnv || 'http://localhost:3003';
}

function extractSessionTokenFromCookie(setCookie) {
  if (!setCookie) return null;
  const match = setCookie.match(/(?:__Secure-)?better-auth\.session_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function identityFromNeonUser(user) {
  if (!user?.id || !user?.email) return null;
  return {
    sub: String(user.id),
    id: String(user.id),
    email: user.email,
    name: user.name,
  };
}

/** Server-side Neon Auth email sign-in/sign-up (avoids cross-domain token relay from the browser). */
async function neonAuthEmailRequest(path, body, _clientOrigin) {
  const base = getNeonAuthBaseUrl();
  if (!base) {
    return { ok: false, status: 503, error: 'Neon Auth is not configured on the API server.' };
  }

  const origin = resolveNeonProxyOrigin();
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, status: 502, error: err.message || 'Could not reach Neon Auth.' };
  }

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  const jwt = res.headers.get('set-auth-jwt');
  const signedSessionToken = res.headers.get('set-auth-token');
  const cookieSession = extractSessionTokenFromCookie(res.headers.get('set-cookie') || '');
  const sessionToken =
    (typeof data.token === 'string' && data.token) ||
    (typeof data.session?.token === 'string' && data.session.token) ||
    cookieSession ||
    null;
  const user = data.user || data.data?.user || null;

  if (!res.ok) {
    const msg = data.message || data.error || text || 'Authentication failed.';
    return { ok: false, status: res.status, error: msg, code: data.code, origin };
  }

  return {
    ok: true,
    jwt: jwt || null,
    signedSessionToken: signedSessionToken || null,
    sessionToken,
    user,
    origin,
  };
}

async function resolveIdentityFromNeonAuthResult(result) {
  const identity = await resolveNeonIdentity(
    result.signedSessionToken || result.sessionToken || result.jwt,
    result.sessionToken,
    result.jwt,
    result.signedSessionToken
  );
  if (identity && (identity.sub || identity.id)) return identity;
  return identityFromNeonUser(result.user);
}

async function neonSignInEmail(email, password, clientOrigin) {
  return neonAuthEmailRequest('/sign-in/email', { email, password }, clientOrigin);
}

async function neonSignUpEmail(name, email, password, clientOrigin) {
  return neonAuthEmailRequest('/sign-up/email', { name, email, password }, clientOrigin);
}

module.exports = {
  isNeonAuthConfigured,
  getNeonAuthBaseUrl,
  validateNeonAuthToken,
  resolveNeonIdentity,
  resolveIdentityFromNeonAuthResult,
  resolveNeonClientOrigin,
  resolveNeonProxyOrigin,
  neonSignInEmail,
  neonSignUpEmail,
  isLikelyJwt,
};
