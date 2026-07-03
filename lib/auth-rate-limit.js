/**
 * Rate limits for public auth endpoints (login, password setup, access requests).
 *
 * Env (optional):
 *   AUTH_RATE_LIMIT_DISABLED=true          — turn off all auth rate limits
 *   AUTH_RATE_LIMIT_LOGIN_MAX=8            — failed credential attempts per window
 *   AUTH_RATE_LIMIT_LOGIN_WINDOW_MIN=15
 *   AUTH_RATE_LIMIT_PUBLIC_MAX=20          — access request / domain check per window
 *   AUTH_RATE_LIMIT_PUBLIC_WINDOW_MIN=60
 *   AUTH_RATE_LIMIT_PORTAL_MAX=40          — portal status lookups per window
 *   AUTH_RATE_LIMIT_PORTAL_WINDOW_MIN=15
 *   AUTH_RATE_LIMIT_AUTH_POST_MAX=60       — overall /api/auth POST cap per IP
 *   AUTH_RATE_LIMIT_AUTH_POST_WINDOW_MIN=15
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function isRateLimitDisabled() {
  if (process.env.AUTH_RATE_LIMIT_DISABLED === 'true') return true;
  if (process.env.NODE_ENV !== 'production' && process.env.AUTH_RATE_LIMIT_DISABLED !== 'false') {
    return true;
  }
  return false;
}

function readPositiveInt(name, fallback) {
  const value = parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function credentialKey(req) {
  const email = normalizeEmail(req.body?.email);
  const ip = ipKeyGenerator(req.ip || req.socket?.remoteAddress || '');
  return email ? `${ip}:${email}` : ip;
}

function rateLimitResponse(_req, res) {
  res.status(429).json({
    error: 'Too many attempts. Please wait a few minutes and try again.',
    code: 'rate_limit_exceeded',
  });
}

function buildCredentialLimiter() {
  const windowMin = readPositiveInt('AUTH_RATE_LIMIT_LOGIN_WINDOW_MIN', 15);
  return rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit: readPositiveInt('AUTH_RATE_LIMIT_LOGIN_MAX', 8),
    keyGenerator: credentialKey,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitResponse,
  });
}

function buildPublicLimiter() {
  const windowMin = readPositiveInt('AUTH_RATE_LIMIT_PUBLIC_WINDOW_MIN', 60);
  return rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit: readPositiveInt('AUTH_RATE_LIMIT_PUBLIC_MAX', 20),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitResponse,
  });
}

function buildPortalLimiter() {
  const windowMin = readPositiveInt('AUTH_RATE_LIMIT_PORTAL_WINDOW_MIN', 15);
  return rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit: readPositiveInt('AUTH_RATE_LIMIT_PORTAL_MAX', 40),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitResponse,
  });
}

function buildAuthPostLimiter() {
  const windowMin = readPositiveInt('AUTH_RATE_LIMIT_AUTH_POST_WINDOW_MIN', 15);
  return rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit: readPositiveInt('AUTH_RATE_LIMIT_AUTH_POST_MAX', 60),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: rateLimitResponse,
  });
}

const CREDENTIAL_PATHS = [
  '/api/auth/login',
  '/api/auth/neon-login',
  '/api/auth/register',
  '/api/auth/neon-register',
  '/api/auth/bootstrap',
  '/api/auth/complete-account-setup',
];

const PUBLIC_PATHS = ['/api/auth/request-access', '/api/auth/check-domain'];

function applyAuthRateLimits(app) {
  if (isRateLimitDisabled()) {
    console.log('[auth-rate-limit] disabled');
    return;
  }

  const credentialLimiter = buildCredentialLimiter();
  const publicLimiter = buildPublicLimiter();
  const portalLimiter = buildPortalLimiter();
  const authPostLimiter = buildAuthPostLimiter();

  app.use('/api/auth', (req, res, next) => {
    if (req.method === 'POST') return authPostLimiter(req, res, next);
    return next();
  });

  for (const path of CREDENTIAL_PATHS) {
    app.use(path, credentialLimiter);
  }

  for (const path of PUBLIC_PATHS) {
    app.use(path, publicLimiter);
  }

  app.use('/api/auth/access-portal', portalLimiter);

  console.log(
    `[auth-rate-limit] enabled login=${readPositiveInt('AUTH_RATE_LIMIT_LOGIN_MAX', 8)}/${readPositiveInt('AUTH_RATE_LIMIT_LOGIN_WINDOW_MIN', 15)}m public=${readPositiveInt('AUTH_RATE_LIMIT_PUBLIC_MAX', 20)}/${readPositiveInt('AUTH_RATE_LIMIT_PUBLIC_WINDOW_MIN', 60)}m`
  );
}

module.exports = {
  applyAuthRateLimits,
  isRateLimitDisabled,
};
