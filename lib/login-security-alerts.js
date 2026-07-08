/**
 * Admin email alerts for repeated failed sign-in attempts.
 * Fires once per rate-limit window at the warning threshold (default 5) and lockout (default 8).
 */

const { ipKeyGenerator } = require('express-rate-limit');
const {
  loginAttemptLimit,
  loginWarningAfterAttempts,
  loginWindowMinutes,
} = require('./auth-rate-limit');
const { notifyAdminsLoginSecurityFlag, isAdminEmailNotifyConfigured } = require('./admin-notify-email');

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function clientIp(req) {
  return ipKeyGenerator(req.ip || req.socket?.remoteAddress || '');
}

function attemptScopeKey(req, email) {
  const normalizedEmail = normalizeEmail(email);
  const ip = clientIp(req);
  return normalizedEmail ? `${ip}:${normalizedEmail}` : ip;
}

function alertCacheKey(req, email, stage) {
  return `${attemptScopeKey(req, email)}:${stage}`;
}

const notifiedAlerts = new Map();
const failedLoginCounters = new Map();

function pruneTimedMap(map) {
  const now = Date.now();
  for (const [key, expiresAt] of map) {
    if (expiresAt <= now) map.delete(key);
  }
}

function pruneCounterMap(map) {
  const now = Date.now();
  for (const [key, entry] of map) {
    if (!entry || entry.resetAt <= now) map.delete(key);
  }
}

function markAlertSent(cacheKey, resetTime) {
  const fallbackTtl = loginWindowMinutes() * 60 * 1000;
  const expiresAt = resetTime && resetTime > Date.now() ? resetTime : Date.now() + fallbackTtl;
  notifiedAlerts.set(cacheKey, expiresAt);
}

function shouldSendAlert(cacheKey, resetTime) {
  pruneTimedMap(notifiedAlerts);
  const expiresAt = notifiedAlerts.get(cacheKey);
  if (expiresAt && expiresAt > Date.now()) return false;
  markAlertSent(cacheKey, resetTime);
  return true;
}

function recordFailedLoginAttempt(req, email) {
  const key = attemptScopeKey(req, email);
  const windowMs = loginWindowMinutes() * 60 * 1000;
  const now = Date.now();
  const limit = loginAttemptLimit();

  pruneCounterMap(failedLoginCounters);
  let entry = failedLoginCounters.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  entry.count += 1;
  failedLoginCounters.set(key, entry);

  return {
    attemptsUsed: entry.count,
    attemptsLimit: limit,
    attemptsRemaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}

function attemptInfoFromRateLimit(req) {
  const rl = req.rateLimit;
  if (!rl || typeof rl.remaining !== 'number' || typeof rl.limit !== 'number') return null;
  return {
    attemptsUsed: rl.limit - rl.remaining,
    attemptsLimit: rl.limit,
    attemptsRemaining: Math.max(0, rl.remaining),
    resetAt: rl.resetTime,
    source: 'rate_limit',
  };
}

function resolveLoginSecurityStage(req, forceStage, attemptInfo) {
  if (forceStage === 'warning' || forceStage === 'lockout') return forceStage;

  const info = attemptInfoFromRateLimit(req) || attemptInfo;
  if (!info) return null;

  if (info.attemptsRemaining <= 0) return 'lockout';
  if (info.attemptsUsed === loginWarningAfterAttempts()) return 'warning';
  return null;
}

async function queueLoginSecurityAdminAlerts(pool, req, email, options = {}) {
  if (!pool) {
    console.warn('[login-security-alerts] Skipped: database pool unavailable');
    return;
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;

  const trackedAttempt =
    options.forceStage === 'lockout' ? null : recordFailedLoginAttempt(req, normalizedEmail);
  const attemptInfo = attemptInfoFromRateLimit(req) || trackedAttempt;
  const stage = resolveLoginSecurityStage(req, options.forceStage, attemptInfo);

  if (!stage) {
    console.log(
      `[login-security-alerts] Attempt ${attemptInfo?.attemptsUsed ?? '?'} for ${normalizedEmail} — no alert threshold reached`
    );
    return;
  }

  if (!isAdminEmailNotifyConfigured()) {
    console.warn(
      '[login-security-alerts] Skipped: RESEND_API_KEY or ADMIN_NOTIFY_FROM not set on the API server'
    );
    return;
  }

  const cacheKey = alertCacheKey(req, normalizedEmail, stage);
  const resetTime = attemptInfo?.resetAt || req.rateLimit?.resetTime;
  if (!shouldSendAlert(cacheKey, resetTime)) {
    console.log(`[login-security-alerts] Suppressed duplicate ${stage} alert for ${normalizedEmail}`);
    return;
  }

  const attemptsLimit = attemptInfo?.attemptsLimit ?? loginAttemptLimit();
  const attemptsRemaining = Math.max(0, attemptInfo?.attemptsRemaining ?? 0);
  const attemptsUsed = Math.max(0, attemptInfo?.attemptsUsed ?? 0);

  console.log(
    `[login-security-alerts] Sending ${stage} alert for ${normalizedEmail} (${attemptsUsed}/${attemptsLimit} attempts)`
  );

  try {
    await notifyAdminsLoginSecurityFlag(pool, {
      stage,
      email: normalizedEmail,
      ip: clientIp(req),
      attemptsUsed: stage === 'lockout' ? attemptsLimit : attemptsUsed,
      attemptsLimit,
      attemptsRemaining,
      lockoutMinutes: loginWindowMinutes(),
      flaggedAt: new Date().toISOString(),
      endpoint: req.originalUrl || req.path || '/api/auth/login',
    });
  } catch (err) {
    console.error('[login-security-alerts] Failed to send alert:', err.message);
    throw err;
  }
}

module.exports = {
  queueLoginSecurityAdminAlerts,
  resolveLoginSecurityStage,
};
