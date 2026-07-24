/**
 * Operational alerts: API errors and security events emailed to admins (Resend).
 *
 * Env (optional):
 *   OPS_ALERTS_DISABLED=true
 *   OPS_ALERT_API_ERROR_MIN_STATUS=500
 *   OPS_ALERT_API_ERROR_COOLDOWN_MIN=15
 *   OPS_ALERT_SECURITY_COOLDOWN_MIN=15
 *   OPS_ALERT_UNAUTHORIZED_API_MAX=10   — per IP per window before security email
 *   OPS_ALERT_UNAUTHORIZED_API_WINDOW_MIN=15
 *   OPS_ALERT_UNAUTHORIZED_SPA_MAX=200  — higher bar for Netlify/localhost tabs with no token
 *   OPS_ALERT_TRUSTED_REFERER_HOSTS=    — optional comma-separated extra SPA hosts
 */

const { ipKeyGenerator } = require('express-rate-limit');
const { notifyAdminsOpsAlert } = require('./admin-notify-email');

let alertPool = null;

function setOpsAlertPool(pool) {
  alertPool = pool;
}

function isOpsAlertsDisabled() {
  if (process.env.OPS_ALERTS_DISABLED === 'true') return true;
  if (process.env.NODE_ENV !== 'production' && process.env.OPS_ALERTS_DISABLED !== 'false') {
    return true;
  }
  return false;
}

function readPositiveInt(name, fallback) {
  const value = parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clientIp(req) {
  return ipKeyGenerator(req?.ip || req?.socket?.remoteAddress || '');
}

function requestPath(req) {
  return (req?.originalUrl || req?.url || '').split('?')[0] || '';
}

function requestMethod(req) {
  return (req?.method || 'GET').toUpperCase();
}

function pruneMap(map) {
  const now = Date.now();
  for (const [key, expiresAt] of map) {
    if (expiresAt <= now) map.delete(key);
  }
}

const dedupeCache = new Map();

function shouldSendDedupedAlert(dedupeKey, cooldownMinutes) {
  pruneMap(dedupeCache);
  const ttlMs = cooldownMinutes * 60 * 1000;
  const existing = dedupeCache.get(dedupeKey);
  if (existing && existing > Date.now()) return false;
  dedupeCache.set(dedupeKey, Date.now() + ttlMs);
  return true;
}

function logOpsEvent(level, message, meta = {}) {
  const suffix = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  const line = `[ops-alerts] ${message}${suffix}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

async function queueOpsAlert(pool, payload) {
  const dbPool = pool || alertPool;
  if (!dbPool) return;
  if (isOpsAlertsDisabled()) return;

  const cooldownMinutes = payload.cooldownMinutes ?? readPositiveInt('OPS_ALERT_SECURITY_COOLDOWN_MIN', 15);
  const dedupeKey = payload.dedupeKey;
  if (dedupeKey && !shouldSendDedupedAlert(dedupeKey, cooldownMinutes)) {
    logOpsEvent('info', 'Suppressed duplicate alert', { dedupeKey });
    return;
  }

  try {
    await notifyAdminsOpsAlert(dbPool, payload);
    logOpsEvent('info', 'Sent ops alert', { category: payload.category, severity: payload.severity });
  } catch (err) {
    logOpsEvent('error', 'Failed to send ops alert', { error: err.message });
  }
}

function queueApiErrorAlert(pool, req, details = {}) {
  const statusCode = details.statusCode || 500;
  const minStatus = readPositiveInt('OPS_ALERT_API_ERROR_MIN_STATUS', 500);
  if (statusCode < minStatus) return;

  const path = details.path || requestPath(req);
  if (path === '/health') return;

  const message = String(details.message || 'Server error').slice(0, 500);
  const method = details.method || requestMethod(req);
  const dedupeKey = `api_error:${statusCode}:${method}:${path}:${message.slice(0, 120)}`;
  const cooldownMinutes = readPositiveInt('OPS_ALERT_API_ERROR_COOLDOWN_MIN', 15);

  void queueOpsAlert(pool, {
    category: 'api_error',
    severity: statusCode >= 500 ? 'critical' : 'warning',
    title: `API error ${statusCode} on ${method} ${path}`,
    summary: message,
    details: {
      statusCode,
      method,
      path,
      ip: clientIp(req),
      durationMs: details.durationMs,
      errorCode: details.errorCode,
      stack: details.stack ? String(details.stack).split('\n').slice(0, 8).join('\n') : undefined,
      flaggedAt: new Date().toISOString(),
    },
    dedupeKey,
    cooldownMinutes,
  });
}

const unauthorizedCounters = new Map();

function pruneCounterMap(map, windowMs) {
  const now = Date.now();
  for (const [key, entry] of map) {
    if (!entry || entry.resetAt <= now) map.delete(key);
  }
}

function requestRefererHost(req) {
  const raw = String(req?.headers?.referer || req?.headers?.referrer || '');
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function hasBearerOrQueryToken(req) {
  const authHeader = req?.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ') && authHeader.length > 7) {
    return true;
  }
  if (typeof req?.query?.token === 'string' && req.query.token.trim()) {
    return true;
  }
  return false;
}

/**
 * Browser tabs on our Netlify/localhost SPA that forgot to send a session token
 * (display pages, stale tabs) are noisy but not external attackers. Keep counting
 * them for logs, but require a much higher threshold before emailing.
 */
function isFirstPartySpaMissingAuth(req) {
  if (hasBearerOrQueryToken(req)) return false;
  const ua = String(req?.headers?.['user-agent'] || '');
  if (!/mozilla\/\d/i.test(ua)) return false;
  const host = requestRefererHost(req);
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (host.endsWith('.netlify.app')) return true;
  const extra = String(process.env.OPS_ALERT_TRUSTED_REFERER_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(host);
}

function recordUnauthorizedApiAccess(pool, req, pathname) {
  if (isOpsAlertsDisabled()) return;

  const windowMin = readPositiveInt('OPS_ALERT_UNAUTHORIZED_API_WINDOW_MIN', 15);
  const spaNoise = isFirstPartySpaMissingAuth(req);
  const threshold = spaNoise
    ? readPositiveInt('OPS_ALERT_UNAUTHORIZED_SPA_MAX', 200)
    : readPositiveInt('OPS_ALERT_UNAUTHORIZED_API_MAX', 10);
  const ip = clientIp(req);
  const key = `${ip}:${pathname || requestPath(req)}:${spaNoise ? 'spa' : 'ext'}`;
  const now = Date.now();
  const windowMs = windowMin * 60 * 1000;

  pruneCounterMap(unauthorizedCounters, windowMs);
  let entry = unauthorizedCounters.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  entry.count += 1;
  unauthorizedCounters.set(key, entry);

  if (entry.count !== threshold) return;

  void queueOpsAlert(pool, {
    category: 'security_unauthorized_api',
    severity: 'warning',
    title: `Repeated unauthorized API access (${ip})`,
    summary: spaNoise
      ? `${entry.count} unauthenticated requests from our web app (no session token) to protected API routes from this IP in the last ${windowMin} minutes. Usually a stale display tab — not an external scan.`
      : `${entry.count} unauthorized requests to protected API routes from this IP in the last ${windowMin} minutes.`,
    details: {
      ip,
      path: pathname || requestPath(req),
      method: requestMethod(req),
      attempts: entry.count,
      windowMinutes: windowMin,
      refererHost: requestRefererHost(req) || undefined,
      firstPartySpaMissingAuth: spaNoise || undefined,
      flaggedAt: new Date().toISOString(),
    },
    dedupeKey: `security_unauthorized_api:${key}`,
    cooldownMinutes: windowMin,
  });
}

function recordAdminAuthFailure(pool, req) {
  const ip = clientIp(req);
  const path = requestPath(req);
  void queueOpsAlert(pool, {
    category: 'security_admin_denied',
    severity: 'warning',
    title: 'Invalid admin API credentials attempted',
    summary: 'Someone tried to access an admin API route with an invalid admin key or PIN.',
    details: {
      ip,
      path,
      method: requestMethod(req),
      flaggedAt: new Date().toISOString(),
    },
    dedupeKey: `security_admin_denied:${ip}:${path}`,
    cooldownMinutes: readPositiveInt('OPS_ALERT_SECURITY_COOLDOWN_MIN', 15),
  });
}

function recordIntegrationForbidden(pool, req, pathname) {
  const ip = clientIp(req);
  void queueOpsAlert(pool, {
    category: 'security_integration_forbidden',
    severity: 'warning',
    title: 'Integration token permission denied',
    summary: 'An integration API token attempted an action it is not allowed to perform.',
    details: {
      ip,
      path: pathname || requestPath(req),
      method: requestMethod(req),
      tokenName: req.auth?.tokenName || undefined,
      flaggedAt: new Date().toISOString(),
    },
    dedupeKey: `security_integration_forbidden:${ip}:${pathname || requestPath(req)}`,
    cooldownMinutes: readPositiveInt('OPS_ALERT_SECURITY_COOLDOWN_MIN', 15),
  });
}

function recordProcessFailure(pool, kind, err) {
  const message = String(err?.message || err || 'Unknown process error').slice(0, 500);
  void queueOpsAlert(pool, {
    category: 'process_error',
    severity: 'critical',
    title: `API process ${kind}`,
    summary: message,
    details: {
      kind,
      stack: err?.stack ? String(err.stack).split('\n').slice(0, 10).join('\n') : undefined,
      flaggedAt: new Date().toISOString(),
    },
    dedupeKey: `process_error:${kind}:${message.slice(0, 120)}`,
    cooldownMinutes: readPositiveInt('OPS_ALERT_API_ERROR_COOLDOWN_MIN', 15),
  });
}

function createOpsResponseMonitor(pool) {
  return function opsResponseMonitor(req, res, next) {
    const startedAt = Date.now();
    const originalJson = res.json.bind(res);
    res.json = function captureOpsJson(body) {
      const status = res.statusCode;
      const minStatus = readPositiveInt('OPS_ALERT_API_ERROR_MIN_STATUS', 500);
      if (status >= minStatus && body && typeof body === 'object' && body !== null) {
        const parts = [];
        if (typeof body.error === 'string') parts.push(body.error);
        if (typeof body.detail === 'string') parts.push(body.detail);
        if (typeof body.message === 'string') parts.push(body.message);
        if (parts.length) res.locals.opsErrorDetail = parts.join(' — ').slice(0, 500);
      }
      return originalJson(body);
    };

    res.on('finish', () => {
      const statusCode = res.statusCode;
      const minStatus = readPositiveInt('OPS_ALERT_API_ERROR_MIN_STATUS', 500);
      if (statusCode < minStatus) return;
      queueApiErrorAlert(pool, req, {
        statusCode,
        message: res.locals.opsErrorDetail || `HTTP ${statusCode}`,
        durationMs: Date.now() - startedAt,
        path: requestPath(req),
        method: requestMethod(req),
      });
    });

    next();
  };
}

function createOpsErrorHandler(pool) {
  return function opsErrorHandler(err, req, res, next) {
    const url = requestPath(req);
    if (url.startsWith('/api/parse-agenda')) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'File too large. Maximum size is 10MB.'
          : err.message || 'Upload failed.';
      return res.status(400).json({ error: msg });
    }

    if (res.headersSent) return next(err);

    const statusCode = err.status || err.statusCode || 500;
    res.locals.opsErrorDetail = err.message || 'Internal server error';
    queueApiErrorAlert(pool, req, {
      statusCode,
      message: res.locals.opsErrorDetail,
      stack: err.stack,
      path: url,
      method: requestMethod(req),
      errorCode: err.code,
    });

    res.status(statusCode).json({
      error: statusCode >= 500 ? 'Internal server error' : err.message || 'Request failed',
      ...(process.env.NODE_ENV !== 'production' && statusCode >= 500 ? { detail: err.message } : {}),
    });
  };
}

function installProcessOpsHandlers(pool) {
  const dbPool = pool || alertPool;
  process.on('unhandledRejection', (reason) => {
    logOpsEvent('error', 'Unhandled promise rejection', { reason: String(reason) });
    recordProcessFailure(dbPool, 'unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
  });
  process.on('uncaughtException', (err) => {
    logOpsEvent('error', 'Uncaught exception', { error: err.message });
    recordProcessFailure(dbPool, 'uncaughtException', err);
  });
}

function installOpsAlerts(app, pool) {
  setOpsAlertPool(pool);
  if (isOpsAlertsDisabled()) {
    console.log('[ops-alerts] disabled');
    return;
  }

  app.use(createOpsResponseMonitor(pool));
  installProcessOpsHandlers(pool);
  console.log(
    `[ops-alerts] enabled apiError>=${readPositiveInt('OPS_ALERT_API_ERROR_MIN_STATUS', 500)} cooldown=${readPositiveInt('OPS_ALERT_API_ERROR_COOLDOWN_MIN', 15)}m`
  );
}

module.exports = {
  setOpsAlertPool,
  installOpsAlerts,
  createOpsErrorHandler,
  createOpsResponseMonitor,
  queueApiErrorAlert,
  queueOpsAlert,
  recordUnauthorizedApiAccess,
  recordAdminAuthFailure,
  recordIntegrationForbidden,
  recordProcessFailure,
  isOpsAlertsDisabled,
};
