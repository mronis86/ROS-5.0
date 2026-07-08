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
const { notifyAdminsLoginSecurityFlag } = require('./admin-notify-email');

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function clientIp(req) {
  return ipKeyGenerator(req.ip || req.socket?.remoteAddress || '');
}

function alertCacheKey(req, email, stage) {
  const normalizedEmail = normalizeEmail(email);
  const ip = clientIp(req);
  const scope = normalizedEmail ? `${ip}:${normalizedEmail}` : ip;
  return `${scope}:${stage}`;
}

const notifiedAlerts = new Map();

function pruneNotifiedAlerts() {
  const now = Date.now();
  for (const [key, expiresAt] of notifiedAlerts) {
    if (expiresAt <= now) notifiedAlerts.delete(key);
  }
}

function markAlertSent(cacheKey, resetTime) {
  const fallbackTtl = loginWindowMinutes() * 60 * 1000;
  const expiresAt = resetTime && resetTime > Date.now() ? resetTime : Date.now() + fallbackTtl;
  notifiedAlerts.set(cacheKey, expiresAt);
}

function shouldSendAlert(cacheKey, resetTime) {
  pruneNotifiedAlerts();
  const expiresAt = notifiedAlerts.get(cacheKey);
  if (expiresAt && expiresAt > Date.now()) return false;
  markAlertSent(cacheKey, resetTime);
  return true;
}

function resolveLoginSecurityStage(req, forceStage) {
  if (forceStage === 'warning' || forceStage === 'lockout') return forceStage;

  const rl = req.rateLimit;
  if (!rl || typeof rl.remaining !== 'number' || typeof rl.limit !== 'number') return null;

  const attemptsUsed = rl.limit - rl.remaining;
  if (rl.remaining <= 0) return 'lockout';
  if (attemptsUsed === loginWarningAfterAttempts()) return 'warning';
  return null;
}

async function queueLoginSecurityAdminAlerts(pool, req, email, options = {}) {
  if (!pool) return;

  const normalizedEmail = normalizeEmail(email);
  const stage = resolveLoginSecurityStage(req, options.forceStage);
  if (!stage) return;

  const cacheKey = alertCacheKey(req, normalizedEmail, stage);
  const resetTime = req.rateLimit?.resetTime;
  if (!shouldSendAlert(cacheKey, resetTime)) return;

  const rl = req.rateLimit;
  const attemptsLimit = rl?.limit ?? loginAttemptLimit();
  const attemptsRemaining = Math.max(0, rl?.remaining ?? 0);
  const attemptsUsed = Math.max(0, attemptsLimit - attemptsRemaining);

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
}

module.exports = {
  queueLoginSecurityAdminAlerts,
  resolveLoginSecurityStage,
};
