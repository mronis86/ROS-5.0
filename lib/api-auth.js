/**
 * Server-side API authentication: user sessions, integration tokens, and request middleware.
 *
 * Env:
 *   REQUIRE_API_AUTH=none|writes|all   (default: none — backward compatible)
 *   ALLOW_LEGACY_PUBLIC_API=true|false (default: true when REQUIRE_API_AUTH=none)
 *   API_SESSION_TTL_HOURS              (default: 168)
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { notifyAdminsNewAccessRequest, notifyUserAccessRequestSubmitted, notifyUserAccessApproved, notifyUserAccessRejected } = require('./admin-notify-email');
const {
  validateNeonAuthToken,
  isNeonAuthConfigured,
  resolveNeonIdentity,
  resolveIdentityFromNeonAuthResult,
  resolveNeonClientOrigin,
  neonSignInEmail,
  neonSignUpEmail,
  getNeonAuthBaseUrl,
} = require('./neon-auth-server');
const { isNeonUserAlreadyExistsError, deleteNeonAuthUser } = require('./neon-auth-db');
const { getLoginRateLimitInfo } = require('./auth-rate-limit');
const { queueLoginSecurityAdminAlerts } = require('./login-security-alerts');
const {
  recordUnauthorizedApiAccess,
  recordIntegrationForbidden,
} = require('./ops-alerts');
const {
  hashPortalToken,
  generatePortalToken,
  isPortalToken,
  getAppPublicOrigin,
  buildAccessPortalUrl,
  needsPasswordSetup,
  ensurePortalToken,
  assignPortalToken,
} = require('./access-portal');

const SESSION_PREFIX = 'ros_sess_';
const NEON_SESSION_PREFIX = 'ros_nsess_';
const INTEGRATION_PREFIX = 'ros_itok_';

const VALID_SCOPES = new Set(['read', 'control', 'write', 'admin', 'backup:export']);

const PUBLIC_API_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/check-domain',
  '/api/auth/bootstrap',
  '/api/auth/access-status',
  '/api/auth/access-request',
  '/api/auth/neon-exchange',
  '/api/auth/neon-login',
  '/api/auth/neon-register',
  '/api/auth/request-access',
  '/api/auth/access-portal',
  '/api/auth/complete-account-setup',
  '/api/auth/setup-status',
]);

const PENDING_USER_ALLOWED_PATHS = new Set([
  '/api/auth/access-status',
  '/api/auth/access-request',
  '/api/auth/check-domain',
]);

/** Public graphics feeds (vMix, Singular, Netlify XML pages) — stay open when REQUIRE_API_AUTH=all */
const PUBLIC_GRAPHICS_PATHS = new Set([
  '/api/lower-thirds.xml',
  '/api/lower-thirds.csv',
  '/api/cache/lower-thirds.xml',
  '/api/cache/lower-thirds.csv',
  '/api/cache/schedule.xml',
  '/api/cache/schedule.csv',
  '/api/cache/custom-columns.xml',
  '/api/cache/custom-columns.csv',
  '/api/led-output/clear',
]);

const RUN_OF_SHOW_DATA_GET = /^\/api\/run-of-show-data\/[0-9a-f-]{36}$/i;

function isReadMethod(method) {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function isPublicGraphicsFeedPath(pathname, method) {
  if (pathname === '/api/led-output/clear' && method === 'POST') return true;
  if (!isReadMethod(method)) return false;
  if (PUBLIC_GRAPHICS_PATHS.has(pathname)) return true;
  return RUN_OF_SHOW_DATA_GET.test(pathname);
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateSessionToken() {
  return SESSION_PREFIX + crypto.randomBytes(32).toString('hex');
}

function generateIntegrationToken() {
  return INTEGRATION_PREFIX + crypto.randomBytes(32).toString('hex');
}

function generateNeonSessionToken() {
  return NEON_SESSION_PREFIX + crypto.randomBytes(32).toString('hex');
}

function tokenPrefix(rawToken) {
  return rawToken.slice(0, 16);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function maybeNotifyLoginSecurity(pool, req, email) {
  queueLoginSecurityAdminAlerts(pool, req, email).catch((err) =>
    console.error('[login-security-alerts]', err.message)
  );
}

function loadApiAuthConfig() {
  const requireLevel = (process.env.REQUIRE_API_AUTH || 'none').toLowerCase();
  const validLevels = new Set(['none', 'writes', 'all']);
  const sessionTtlHours = Math.max(1, parseInt(process.env.API_SESSION_TTL_HOURS || '168', 10) || 168);
  const allowLegacy =
    process.env.ALLOW_LEGACY_PUBLIC_API !== undefined
      ? process.env.ALLOW_LEGACY_PUBLIC_API === 'true'
      : requireLevel === 'none';

  return {
    requireLevel: validLevels.has(requireLevel) ? requireLevel : 'none',
    allowLegacy,
    sessionTtlHours,
    registrationOpen: process.env.AUTH_REGISTRATION_OPEN === 'true',
  };
}

function getBearerOrQueryToken(req) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return '';
}

function extractEventIdFromRequest(req) {
  const fromParams = req.params?.eventId || req.params?.id;
  if (fromParams) return String(fromParams);
  const body = req.body || {};
  if (body.event_id) return String(body.event_id);
  if (body.eventId) return String(body.eventId);
  if (typeof req.query.eventId === 'string') return req.query.eventId;
  return null;
}

function getApiPathname(req) {
  const fromOriginal = (req.originalUrl || req.url || '').split('?')[0];
  if (fromOriginal.startsWith('/api')) return fromOriginal;
  const sub = req.path || '';
  if (sub.startsWith('/api')) return sub;
  return fromOriginal || sub;
}

function pathRequiresAuth(pathname, method, config) {
  if (config.requireLevel === 'none') return false;
  if (PUBLIC_API_PATHS.has(pathname)) return false;
  if (pathname.startsWith('/api/admin/')) return false; // per-route admin key checks
  if (isPublicGraphicsFeedPath(pathname, method)) return false;
  if (config.allowLegacy) return false;
  if (config.requireLevel === 'writes') return !isReadMethod(method);
  return true; // all
}

function integrationScopesAllowWrite(scopes) {
  return scopes.includes('write') || scopes.includes('admin');
}

function integrationScopesAllowControl(scopes) {
  return scopes.includes('control') || scopes.includes('write') || scopes.includes('admin');
}

function integrationScopesAllowRead(scopes) {
  return (
    scopes.includes('read') ||
    scopes.includes('control') ||
    scopes.includes('write') ||
    scopes.includes('admin') ||
    scopes.includes('backup:export')
  );
}

function checkIntegrationAccess(auth, req) {
  const method = req.method;
  const scopes = auth.scopes || [];
  if (scopes.includes('admin')) return true;

  if (auth.type === 'integration' && auth.eventId) {
    const requestEventId = extractEventIdFromRequest(req);
    if (requestEventId && requestEventId !== auth.eventId) {
      return false;
    }
  }

  if (isReadMethod(method)) {
    return integrationScopesAllowRead(scopes);
  }
  if (method === 'DELETE' || method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const path = req.pathForScope || req.path || req.originalUrl || '';
    if (path.includes('/timers/') || path.includes('/cues/') || path.includes('/sub-cue-timers')) {
      return integrationScopesAllowControl(scopes);
    }
    if (path.includes('/backup/upcoming-export')) {
      return scopes.includes('backup:export') || scopes.includes('admin');
    }
    return integrationScopesAllowWrite(scopes);
  }
  return false;
}

async function getAccessRecord(pool, neonUserId, email) {
  try {
    const normalizedEmail = normalizeEmail(email);
    const r = neonUserId
      ? await pool.query(
          `SELECT id, neon_user_id, email, full_name, status, is_admin, dashboard_enabled, requested_at, reviewed_at, reviewed_by, notes, password_set_at
           FROM public.api_user_access
           WHERE neon_user_id = $1 OR email = $2
           LIMIT 1`,
          [neonUserId, normalizedEmail]
        )
      : await pool.query(
          `SELECT id, neon_user_id, email, full_name, status, is_admin, dashboard_enabled, requested_at, reviewed_at, reviewed_by, notes, password_set_at
           FROM public.api_user_access
           WHERE email = $1
           LIMIT 1`,
          [normalizedEmail]
        );
    return r.rows[0] || null;
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

async function getAccessByPortalToken(pool, rawToken) {
  if (!isPortalToken(rawToken)) return null;
  try {
    const tokenHash = hashPortalToken(rawToken);
    const r = await pool.query(
      `SELECT id, neon_user_id, email, full_name, status, is_admin, dashboard_enabled, requested_at, reviewed_at, reviewed_by, notes, password_set_at, portal_token
       FROM public.api_user_access
       WHERE portal_token_hash = $1 OR portal_token = $2
       LIMIT 1`,
      [tokenHash, rawToken]
    );
    return r.rows[0] || null;
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

async function loadAllowedEventIds(pool, accessId) {
  if (!accessId) return null;
  try {
    const r = await pool.query(
      `SELECT event_id FROM public.api_user_event_access WHERE access_id = $1`,
      [accessId]
    );
    if (r.rows.length === 0) return null;
    return new Set(r.rows.map((row) => String(row.event_id)));
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

function userCanAccessEvent(auth, eventId) {
  if (!eventId) return true;
  if (!auth) return true;
  if (auth.isAdmin) return true;
  if (!auth.allowedEventIds) return true;
  return auth.allowedEventIds.has(String(eventId));
}

function filterCalendarEventsForAuth(events, auth) {
  if (!auth || auth.isAdmin || !auth.allowedEventIds) return events;
  return events.filter((event) => auth.allowedEventIds.has(String(event.id)));
}

function isUndefinedColumnError(err, columnName) {
  const msg = String(err?.message || '');
  const missing =
    err?.code === '42703' || /column .* does not exist/i.test(msg);
  if (!missing) return false;
  if (!columnName) return true;
  return msg.includes(columnName);
}

function parseBoolBody(value) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return !!value;
}

function resolveDashboardEnabled(access, isAdmin) {
  if (isAdmin) return true;
  return !!access?.dashboard_enabled;
}

function userCanAccessDashboard(auth) {
  if (!auth) return false;
  if (auth.isAdmin) return true;
  return !!auth.dashboardEnabled;
}

async function buildNeonUserAuth(pool, access, identity) {
  const approved = access?.status === 'approved';
  const isAdmin = approved && !!access?.is_admin;
  const dashboardEnabled = approved && resolveDashboardEnabled(access, isAdmin);
  let allowedEventIds = null;
  if (approved && access?.id && !isAdmin) {
    allowedEventIds = await loadAllowedEventIds(pool, access.id);
  }
  return {
    type: 'neon_user',
    userId: String(identity.userId || ''),
    email: normalizeEmail(identity.email),
    fullName: String(identity.fullName || access?.full_name || ''),
    accessStatus: access?.status || 'none',
    accessId: access?.id || null,
    isAdmin,
    dashboardEnabled,
    allowedEventIds,
    scopes: approved ? (isAdmin ? ['read', 'control', 'write', 'admin'] : ['read', 'control', 'write']) : [],
  };
}

async function resolveAuth(pool, rawToken) {
  if (!rawToken) return null;

  if (rawToken.startsWith(NEON_SESSION_PREFIX)) {
    const tokenHash = hashToken(rawToken);
    try {
      const r = await pool.query(
        `SELECT id, neon_user_id, email, expires_at
         FROM public.api_neon_sessions
         WHERE token_hash = $1 AND expires_at > NOW()`,
        [tokenHash]
      );
      if (r.rows.length === 0) return null;
      const row = r.rows[0];
      pool.query('UPDATE public.api_neon_sessions SET last_used_at = NOW() WHERE id = $1', [row.id]).catch(() => {});
      const access = await getAccessRecord(pool, row.neon_user_id, row.email);
      return buildNeonUserAuth(pool, access, {
        userId: row.neon_user_id,
        email: row.email,
        fullName: access?.full_name || '',
      });
    } catch (err) {
      if (err.code === '42P01') return null;
      throw err;
    }
  }

  const neonPayload = await validateNeonAuthToken(rawToken);
  if (neonPayload) {
    const neonUserId = String(neonPayload.sub || neonPayload.id || '');
    const email = normalizeEmail(neonPayload.email);
    const access = neonUserId ? await getAccessRecord(pool, neonUserId, email) : null;
    return buildNeonUserAuth(pool, access, {
      userId: neonUserId,
      email,
      fullName: neonPayload.name || access?.full_name || '',
    });
  }

  if (rawToken.startsWith(SESSION_PREFIX)) {
    const tokenHash = hashToken(rawToken);
    const r = await pool.query(
      `SELECT s.id AS session_id, s.expires_at, u.id, u.email, u.full_name, u.is_admin
       FROM public.api_sessions s
       JOIN public.api_users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [tokenHash]
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    pool.query('UPDATE public.api_sessions SET last_used_at = NOW() WHERE id = $1', [row.session_id]).catch(() => {});
    return {
      type: 'user',
      userId: row.id,
      email: row.email,
      fullName: row.full_name,
      isAdmin: !!row.is_admin,
      dashboardEnabled: !!row.is_admin,
      scopes: row.is_admin ? ['read', 'control', 'write', 'admin'] : ['read', 'control', 'write'],
    };
  }

  if (rawToken.startsWith(INTEGRATION_PREFIX)) {
    const tokenHash = hashToken(rawToken);
    const r = await pool.query(
      `SELECT id, name, scopes, event_id, expires_at, revoked_at
       FROM public.api_integration_tokens
       WHERE token_hash = $1`,
      [tokenHash]
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    if (row.revoked_at) return null;
    if (row.expires_at && new Date(row.expires_at) <= new Date()) return null;
    pool.query('UPDATE public.api_integration_tokens SET last_used_at = NOW() WHERE id = $1', [row.id]).catch(() => {});
    return {
      type: 'integration',
      tokenId: row.id,
      tokenName: row.name,
      scopes: row.scopes || [],
      eventId: row.event_id ? String(row.event_id) : null,
      isAdmin: (row.scopes || []).includes('admin'),
    };
  }

  return null;
}

async function createNeonApiSession(pool, config, identity, fullName) {
  const neonUserId = String(identity.sub || identity.id || '');
  const email = normalizeEmail(identity.email);
  if (!neonUserId || !email) {
    return { error: 'Neon Auth session is missing user identity.', status: 401 };
  }

  const domainCheck = await checkEmailDomainAllowed(pool, email);
  if (!domainCheck.allowed) {
    return { error: domainCheck.message, status: 403 };
  }

  const name = String(fullName || identity.name || '').trim();
  const accessRow = await ensureNeonAccessRecord(pool, neonUserId, email, name);

  const sessionTtlHours = config.sessionTtlHours;
  const expiresAt = new Date(Date.now() + sessionTtlHours * 60 * 60 * 1000);
  const apiToken = generateNeonSessionToken();
  const tokenHash = hashToken(apiToken);

  await pool.query(
    `INSERT INTO public.api_neon_sessions (neon_user_id, email, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [neonUserId, email, tokenHash, expiresAt.toISOString()]
  );

  return {
    token: apiToken,
    expires_at: expiresAt.toISOString(),
    status: accessRow.status,
    is_admin: accessRow.is_admin,
    dashboard_enabled: resolveDashboardEnabled(accessRow, !!accessRow.is_admin),
    email: accessRow.email,
    full_name: accessRow.full_name,
    neon_user_id: neonUserId,
    message:
      accessRow.status === 'approved'
        ? 'Signed in successfully.'
        : 'Access request submitted. An administrator must approve your account.',
  };
}

function neonAuthOriginError(result) {
  if (result.code !== 'INVALID_ORIGIN' && result.code !== 'MISSING_OR_NULL_ORIGIN') return null;
  return {
    error: result.error || 'Invalid origin for Neon Auth.',
    hint: `Server-side login proxies through Railway — set NEON_AUTH_CLIENT_ORIGIN on Railway to an allowed origin (default http://localhost:3003). Neon trusted domains are for browser redirects, not this API path. Attempted origin: "${result.origin}".`,
    neonAuthConfigured: isNeonAuthConfigured(),
    neonAuthHost: isNeonAuthConfigured() ? new URL(getNeonAuthBaseUrl()).host : null,
  };
}

function getDatabaseHostHint() {
  const url = process.env.NEON_DATABASE_URL || '';
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function getAuthTablesStatus(pool) {
  const names = [
    'api_users',
    'api_sessions',
    'api_integration_tokens',
    'api_user_access',
    'api_neon_sessions',
  ];
  const r = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [names]
  );
  const found = new Set(r.rows.map((row) => row.table_name));
  const tables = {};
  for (const name of names) {
    tables[name] = found.has(name);
  }
  return tables;
}

function authTablesReady(tables) {
  return tables.api_user_access && tables.api_neon_sessions;
}

function authMigrationErrorPayload(err) {
  const databaseHost = getDatabaseHostHint();
  return {
    error: 'Auth tables not found on the API database.',
    detail: err.message,
    databaseHost,
    hint:
      `Run migrations/026, 027, 028, and 029 in Neon SQL Editor on branch ${databaseHost || '(NEON_DATABASE_URL host)'}. ` +
      'NEON_DATABASE_URL on Railway must use the same branch as Neon Auth (ep-icy-rice-...).',
  };
}

async function ensureNeonAccessRecord(pool, neonUserId, email, fullName) {
  const normalizedEmail = normalizeEmail(email);
  const name = String(fullName || '').trim() || normalizedEmail.split('@')[0] || 'User';
  const existing = await getAccessRecord(pool, neonUserId, normalizedEmail);
  if (existing) return existing;

  const adminCount = await pool.query(
    `SELECT COUNT(*)::int AS n FROM public.api_user_access WHERE status = 'approved' AND is_admin = TRUE`
  );
  const isFirstAdmin = (adminCount.rows[0]?.n ?? 0) === 0;

  const r = await pool.query(
    `INSERT INTO public.api_user_access (neon_user_id, email, full_name, status, is_admin)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (neon_user_id) DO UPDATE SET
       email = EXCLUDED.email,
       full_name = CASE WHEN EXCLUDED.full_name <> '' THEN EXCLUDED.full_name ELSE api_user_access.full_name END
     RETURNING id, neon_user_id, email, full_name, status, is_admin, requested_at`,
    [neonUserId, normalizedEmail, name, isFirstAdmin ? 'approved' : 'pending', isFirstAdmin]
  );
  const row = r.rows[0];
  if (row.status === 'pending') {
    notifyAdminsNewAccessRequest(pool, {
      email: row.email,
      fullName: row.full_name,
      requestedAt: row.requested_at,
    }).catch((err) => console.error('[admin-notify-email]', err.message));
  }
  return row;
}

function createApiAuthMiddleware(pool, config) {
  return async function apiAuthMiddleware(req, res, next) {
    const requestPath = (req.originalUrl || req.url || '').split('?')[0];
    if (!requestPath.startsWith('/api')) return next();

    const pathname = getApiPathname(req);

    const rawToken = getBearerOrQueryToken(req);
    if (rawToken) {
      try {
        const auth = await resolveAuth(pool, rawToken);
        if (auth) {
          req.auth = auth;
        }
      } catch (err) {
        console.error('[api-auth] resolve error:', err.message);
      }
    }

    if (req.auth?.type === 'neon_user' && req.auth.accessStatus !== 'approved') {
      if (!PENDING_USER_ALLOWED_PATHS.has(pathname)) {
        return res.status(403).json({
          error: 'access_pending',
          status: req.auth.accessStatus,
          message:
            req.auth.accessStatus === 'rejected'
              ? 'Your access request was declined. Contact an administrator.'
              : 'Your account is awaiting administrator approval.',
        });
      }
      return next();
    }

    if (!pathRequiresAuth(pathname, req.method, config)) {
      return next();
    }

    if (!req.auth) {
      recordUnauthorizedApiAccess(pool, req, pathname);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required. Sign in to the web app or provide a valid API token.',
      });
    }

    if (req.auth.type === 'user' || req.auth.type === 'neon_user') {
      return next();
    }

    if (req.auth.type === 'integration') {
      req.pathForScope = pathname;
      if (checkIntegrationAccess(req.auth, req)) {
        return next();
      }
      recordIntegrationForbidden(pool, req, pathname);
      return res.status(403).json({ error: 'Forbidden', message: 'Integration token lacks permission for this action.' });
    }

    return res.status(401).json({ error: 'Unauthorized' });
  };
}

async function checkEmailDomainAllowed(pool, email) {
  const domain = normalizeEmail(email).split('@')[1];
  if (!domain || !email.includes('@') || email.includes(' ')) {
    return { allowed: false, message: 'Invalid email' };
  }
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM public.admin_approved_domains');
  const total = count.rows[0]?.n ?? 0;
  if (total === 0) return { allowed: true };
  const r = await pool.query(
    'SELECT 1 FROM public.admin_approved_domains WHERE LOWER(domain) = $1',
    [domain]
  );
  if (r.rows.length > 0) return { allowed: true };
  return {
    allowed: false,
    message: 'We are having trouble authorizing your account request. Please contact an administrator.',
  };
}

function registerAuthRoutes(app, pool, options = {}) {
  const config = loadApiAuthConfig();
  const requireAdminAuth = options.requireAdminAuth;

  app.get('/api/auth/setup-status', async (req, res) => {
    try {
      const tables = await getAuthTablesStatus(pool);
      const databaseHost = getDatabaseHostHint();
      const neonAuthHost = isNeonAuthConfigured() ? new URL(getNeonAuthBaseUrl()).host : null;
      const authBranchMatch =
        Boolean(databaseHost && neonAuthHost) &&
        (databaseHost.includes('icy-rice') === neonAuthHost.includes('icy-rice') ||
          databaseHost.split('.')[0].replace('-pooler', '') === neonAuthHost.split('.')[0]);

      return res.json({
        neonAuthConfigured: isNeonAuthConfigured(),
        neonAuthHost,
        databaseHost,
        authBranchLikelyMatches: authBranchMatch,
        tables,
        ready: isNeonAuthConfigured() && authTablesReady(tables),
        userFlow: {
          signUp: 'POST /api/auth/request-access (Request access tab — email + name only)',
          signIn: 'POST /api/auth/neon-login (Sign in tab)',
          portal: 'GET /access?token=… (status + password setup after approval)',
          approval: 'Admin page → Access requests (first user auto-approved as admin)',
        },
      });
    } catch (err) {
      console.error('[auth setup-status]', err);
      res.status(500).json({ error: 'Failed to check auth setup.', detail: err.message });
    }
  });

  app.post('/api/auth/check-domain', async (req, res) => {
    try {
      const { email } = req.body || {};
      const result = await checkEmailDomainAllowed(pool, email);
      return res.json(result);
    } catch (err) {
      console.error('[auth check-domain]', err);
      res.status(500).json({ allowed: false, message: 'Unable to verify domain. Please try again.' });
    }
  });

  app.post('/api/auth/request-access', async (req, res) => {
    try {
      const { email, full_name: fullName } = req.body || {};
      const normalizedEmail = normalizeEmail(email);
      const name = String(fullName || '').trim();
      if (!normalizedEmail || !name) {
        return res.status(400).json({ error: 'Email and full name are required.' });
      }

      const domainCheck = await checkEmailDomainAllowed(pool, normalizedEmail);
      if (!domainCheck.allowed) {
        return res.status(403).json({ error: domainCheck.message });
      }

      const origin = getAppPublicOrigin(req);
      let existing = await getAccessRecord(pool, null, normalizedEmail);

      if (existing?.status === 'approved' && !needsPasswordSetup(existing)) {
        return res.json({
          status: 'approved',
          message: 'Your account is already approved. Sign in to continue.',
        });
      }

      if (existing?.status === 'rejected') {
        return res.status(403).json({
          status: 'rejected',
          message: 'Your access request was declined. Contact an administrator.',
        });
      }

      if (existing) {
        const portalToken = await assignPortalToken(pool, existing.id);
        const portalUrl = buildAccessPortalUrl(origin, portalToken);
        if (existing.status === 'pending') {
          notifyUserAccessRequestSubmitted({ email: existing.email, fullName: existing.full_name, portalUrl }).catch(
            (err) => console.error('[admin-notify-email]', err.message)
          );
        } else if (needsPasswordSetup(existing)) {
          notifyUserAccessApproved({
            email: existing.email,
            fullName: existing.full_name,
            isAdmin: !!existing.is_admin,
            portalUrl,
          }).catch((err) => console.error('[admin-notify-email]', err.message));
        }
        return res.json({
          status: existing.status,
          message:
            existing.status === 'pending'
              ? 'Access request already submitted. Save your personal link below to check status.'
              : 'Your account is approved. Use your personal link below to set your password.',
          portalUrl,
        });
      }

      const adminCount = await pool.query(
        `SELECT COUNT(*)::int AS n FROM public.api_user_access WHERE status = 'approved' AND is_admin = TRUE`
      );
      const isFirstAdmin = (adminCount.rows[0]?.n ?? 0) === 0;
      const status = isFirstAdmin ? 'approved' : 'pending';
      const portalToken = generatePortalToken();
      const portalTokenHash = hashPortalToken(portalToken);

      const r = await pool.query(
        `INSERT INTO public.api_user_access (neon_user_id, email, full_name, status, is_admin, portal_token_hash, portal_token)
         VALUES (NULL, $1, $2, $3, $4, $5, $6)
         RETURNING id, email, full_name, status, is_admin, requested_at`,
        [normalizedEmail, name, status, isFirstAdmin, portalTokenHash, portalToken]
      );
      const row = r.rows[0];
      const portalUrl = buildAccessPortalUrl(origin, portalToken);

      if (row.status === 'pending') {
        notifyAdminsNewAccessRequest(pool, {
          email: row.email,
          fullName: row.full_name,
          requestedAt: row.requested_at,
        }).catch((err) => console.error('[admin-notify-email]', err.message));
        notifyUserAccessRequestSubmitted({ email: row.email, fullName: row.full_name, portalUrl }).catch(
          (err) => console.error('[admin-notify-email]', err.message)
        );
      } else {
        notifyUserAccessApproved({
          email: row.email,
          fullName: row.full_name,
          isAdmin: !!row.is_admin,
          portalUrl,
        }).catch((err) => console.error('[admin-notify-email]', err.message));
      }

      return res.status(201).json({
        status: row.status,
        is_admin: row.is_admin,
        message:
          row.status === 'approved'
            ? 'You are the first user and were approved as administrator. Save your personal link below — you need it to set your password.'
            : 'Access request submitted. Save your personal link below before you leave — you will need it after an admin approves you.',
        portalUrl,
      });
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json({
          error: 'Run migrations 027 and 029 on Neon for access portal.',
          hint: 'Migration 029 allows passwordless access requests and portal links.',
        });
      }
      console.error('[auth request-access]', err);
      res.status(500).json({ error: 'Failed to submit access request.' });
    }
  });

  app.get('/api/auth/access-portal', async (req, res) => {
    try {
      const rawToken = String(req.query.token || '').trim();
      if (!isPortalToken(rawToken)) {
        return res.status(400).json({ error: 'Invalid or missing portal link.' });
      }

      const row = await getAccessByPortalToken(pool, rawToken);
      if (!row) {
        return res.status(404).json({
          error:
            'This link is invalid or has expired. If your access was recently approved, check your email for an approval message with an updated link.',
        });
      }

      if (!row.portal_token) {
        await pool.query(`UPDATE public.api_user_access SET portal_token = $1 WHERE id = $2`, [rawToken, row.id]).catch(
          () => {}
        );
      }

      return res.json({
        status: row.status,
        email: row.email,
        full_name: row.full_name,
        is_admin: !!row.is_admin,
        needs_password_setup: needsPasswordSetup(row),
        notes: row.notes || null,
        requested_at: row.requested_at,
        reviewed_at: row.reviewed_at,
      });
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json({ error: 'Run migration 029 on Neon for access portal.' });
      }
      console.error('[auth access-portal]', err);
      res.status(500).json({ error: 'Failed to load access status.' });
    }
  });

  app.post('/api/auth/complete-account-setup', async (req, res) => {
    try {
      if (!isNeonAuthConfigured()) {
        return res.status(503).json({
          error: 'Neon Auth is not configured on the API server.',
          hint: 'Set NEON_AUTH_BASE_URL on Railway and redeploy.',
        });
      }

      const { token: rawToken, password } = req.body || {};
      const portalToken = String(rawToken || '').trim();
      if (!isPortalToken(portalToken)) {
        return res.status(400).json({ error: 'Invalid portal link.' });
      }
      if (!password || String(password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }

      const row = await getAccessByPortalToken(pool, portalToken);
      if (!row) {
        return res.status(404).json({ error: 'This link is invalid or has expired.' });
      }
      if (row.status !== 'approved') {
        return res.status(403).json({
          error: 'Your account is not approved yet.',
          status: row.status,
        });
      }
      if (!needsPasswordSetup(row)) {
        return res.status(400).json({
          error: 'Your password is already set. Sign in to continue.',
          status: row.status,
        });
      }

      const email = normalizeEmail(row.email);
      const name = String(row.full_name || '').trim() || email.split('@')[0] || 'User';
      const clientOrigin = resolveNeonClientOrigin(req.headers.origin, req.headers.referer);

      const signUpResult = await neonSignUpEmail(name, email, String(password), clientOrigin);
      let neonResult = signUpResult;
      if (!signUpResult.ok) {
        const originErr = neonAuthOriginError(signUpResult);
        if (originErr) return res.status(403).json(originErr);

        if (isNeonUserAlreadyExistsError(signUpResult)) {
          const signInResult = await neonSignInEmail(email, String(password), clientOrigin);
          if (signInResult.ok) {
            neonResult = signInResult;
          } else if (!row.neon_user_id) {
            const removed = await deleteNeonAuthUser(pool, { email, neonUserId: row.neon_user_id });
            if (removed.deleted) {
              neonResult = await neonSignUpEmail(name, email, String(password), clientOrigin);
            }
          }
        }

        if (!neonResult.ok) {
          return res.status(neonResult.status === 403 ? 403 : 400).json({
            error:
              neonResult.error ||
              (isNeonUserAlreadyExistsError(signUpResult)
                ? 'An account with this email already exists. Ask an administrator to remove your user and try again, or sign in if you already set a password.'
                : 'Could not create your account.'),
            code: neonResult.code,
          });
        }
      }

      if (!neonResult.user && !neonResult.jwt && !neonResult.signedSessionToken && !neonResult.sessionToken) {
        neonResult = await neonSignInEmail(email, String(password), clientOrigin);
        if (!neonResult.ok) {
          return res.status(400).json({
            error: neonResult.error || 'Account created but sign-in failed. Try signing in.',
          });
        }
      }

      const identity = await resolveIdentityFromNeonAuthResult(neonResult);
      if (!identity) {
        return res.status(502).json({ error: 'Account created but user identity could not be resolved.' });
      }

      const neonUserId = String(identity.sub || identity.id || '');
      await pool.query(
        `UPDATE public.api_user_access
         SET neon_user_id = $1, password_set_at = NOW(), full_name = CASE WHEN full_name = '' THEN $2 ELSE full_name END
         WHERE id = $3`,
        [neonUserId, name, row.id]
      );

      const session = await createNeonApiSession(pool, config, identity, name);
      if (session.error) {
        return res.status(session.status || 500).json({ error: session.error });
      }

      return res.json({
        ...session,
        message: 'Account setup complete. You are signed in.',
      });
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json(authMigrationErrorPayload(err));
      }
      console.error('[auth complete-account-setup]', err);
      res.status(500).json({ error: 'Failed to complete account setup.' });
    }
  });

  app.get('/api/auth/access-status', async (req, res) => {
    try {
      const rawToken = getBearerOrQueryToken(req);
      const auth = await resolveAuth(pool, rawToken);
      if (!auth || auth.type !== 'neon_user') {
        return res.status(401).json({ error: 'Unauthorized', neonAuthConfigured: isNeonAuthConfigured() });
      }
      return res.json({
        status: auth.accessStatus,
        email: auth.email,
        full_name: auth.fullName,
        is_admin: auth.isAdmin,
        dashboard_enabled: auth.dashboardEnabled,
        neon_user_id: auth.userId,
      });
    } catch (err) {
      console.error('[auth access-status]', err);
      res.status(500).json({ error: 'Failed to load access status.' });
    }
  });

  app.post('/api/auth/access-request', async (req, res) => {
    try {
      const rawToken = getBearerOrQueryToken(req);
      const auth = await resolveAuth(pool, rawToken);
      if (!auth || auth.type !== 'neon_user') {
        return res.status(401).json({
          error: 'Sign in with Neon Auth before requesting access.',
          neonAuthConfigured: isNeonAuthConfigured(),
          hint: isNeonAuthConfigured()
            ? 'Call POST /api/auth/neon-login after sign-in to obtain an API session token.'
            : 'Set NEON_AUTH_BASE_URL on Railway to your Neon Auth URL and redeploy.',
        });
      }

      const domainCheck = await checkEmailDomainAllowed(pool, auth.email);
      if (!domainCheck.allowed) {
        return res.status(403).json({ error: domainCheck.message });
      }

      const fullName = String((req.body && req.body.full_name) || auth.fullName || '').trim();
      const existing = await getAccessRecord(pool, auth.userId, auth.email);
      if (existing?.status === 'approved') {
        return res.json({ status: 'approved', message: 'Access already approved.' });
      }
      if (existing?.status === 'pending') {
        return res.json({ status: 'pending', message: 'Access request already submitted.' });
      }
      if (existing?.status === 'rejected') {
        return res.status(403).json({ status: 'rejected', message: 'Your access request was declined. Contact an administrator.' });
      }

      const row = await ensureNeonAccessRecord(pool, auth.userId, auth.email, fullName);
      res.status(201).json({
        status: row.status,
        is_admin: row.is_admin,
        message: row.status === 'approved'
          ? 'You are the first user and were approved as administrator.'
          : 'Access request submitted. An administrator will review your account.',
      });
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json({ error: 'Run migration 027 on Neon for access approval.' });
      }
      console.error('[auth access-request]', err);
      res.status(500).json({ error: 'Failed to submit access request.' });
    }
  });

  app.post('/api/auth/neon-exchange', async (req, res) => {
    try {
      if (!isNeonAuthConfigured()) {
        return res.status(503).json({
          error: 'Neon Auth is not configured on the API server.',
          hint: 'Set NEON_AUTH_BASE_URL on Railway and redeploy.',
        });
      }

      const rawToken = getBearerOrQueryToken(req);
      const sessionToken = typeof req.body?.session_token === 'string' ? req.body.session_token.trim() : '';
      const bodyJwt = typeof req.body?.jwt === 'string' ? req.body.jwt.trim() : '';
      const signedSessionToken =
        typeof req.body?.signed_session_token === 'string' ? req.body.signed_session_token.trim() : '';
      const identity = await resolveNeonIdentity(rawToken, sessionToken, bodyJwt, signedSessionToken);
      if (!identity) {
        return res.status(401).json({
          error: 'Invalid or expired Neon Auth session.',
          hint: 'Sign in again. Prefer POST /api/auth/neon-login (email + password) instead of token exchange.',
          neonAuthConfigured: isNeonAuthConfigured(),
          neonAuthHost: isNeonAuthConfigured() ? new URL(getNeonAuthBaseUrl()).host : null,
        });
      }

      const fullName = String((req.body && req.body.full_name) || identity.name || '').trim();
      const session = await createNeonApiSession(pool, config, identity, fullName);
      if (session.error) {
        return res.status(session.status || 500).json({ error: session.error });
      }
      return res.json(session);
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json(authMigrationErrorPayload(err));
      }
      console.error('[auth neon-exchange]', err);
      res.status(500).json({ error: 'Failed to exchange Neon Auth session.' });
    }
  });

  app.post('/api/auth/neon-login', async (req, res) => {
    try {
      if (!isNeonAuthConfigured()) {
        return res.status(503).json({
          error: 'Neon Auth is not configured on the API server.',
          hint: 'Set NEON_AUTH_BASE_URL on Railway and redeploy.',
        });
      }

      const { email, password, full_name: fullName } = req.body || {};
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      const clientOrigin = resolveNeonClientOrigin(req.headers.origin, req.headers.referer);
      const neonResult = await neonSignInEmail(normalizedEmail, password, clientOrigin);
      if (!neonResult.ok) {
        const originErr = neonAuthOriginError(neonResult);
        if (originErr) return res.status(403).json(originErr);
        const status = neonResult.status === 401 ? 401 : neonResult.status === 403 ? 403 : 400;
        const payload = {
          error: neonResult.error || 'Invalid email or password.',
          code: neonResult.code,
        };
        if (status === 401) {
          Object.assign(payload, getLoginRateLimitInfo(req));
          maybeNotifyLoginSecurity(pool, req, normalizedEmail);
        }
        return res.status(status).json(payload);
      }

      const identity = await resolveIdentityFromNeonAuthResult(neonResult);
      if (!identity) {
        return res.status(502).json({
          error: 'Neon sign-in succeeded but user identity could not be resolved.',
          hint: 'Check NEON_AUTH_BASE_URL matches VITE_NEON_AUTH_URL and Neon Auth is on the same DB branch.',
        });
      }

      const session = await createNeonApiSession(pool, config, identity, fullName);
      if (session.error) {
        return res.status(session.status || 500).json({ error: session.error });
      }
      return res.json(session);
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json(authMigrationErrorPayload(err));
      }
      console.error('[auth neon-login]', err);
      res.status(500).json({ error: 'Failed to sign in with Neon Auth.' });
    }
  });

  app.post('/api/auth/neon-register', async (req, res) => {
    try {
      if (!isNeonAuthConfigured()) {
        return res.status(503).json({
          error: 'Neon Auth is not configured on the API server.',
          hint: 'Set NEON_AUTH_BASE_URL on Railway and redeploy.',
        });
      }

      const { email, password, full_name: fullName } = req.body || {};
      const normalizedEmail = normalizeEmail(email);
      const name = String(fullName || '').trim() || normalizedEmail.split('@')[0] || 'User';
      if (!normalizedEmail || !password || password.length < 8) {
        return res.status(400).json({ error: 'Email and password (min 8 characters) are required.' });
      }

      const domainCheck = await checkEmailDomainAllowed(pool, normalizedEmail);
      if (!domainCheck.allowed) {
        return res.status(403).json({ error: domainCheck.message });
      }

      const clientOrigin = resolveNeonClientOrigin(req.headers.origin, req.headers.referer);
      const signUpResult = await neonSignUpEmail(name, normalizedEmail, password, clientOrigin);
      if (!signUpResult.ok) {
        const originErr = neonAuthOriginError(signUpResult);
        if (originErr) return res.status(403).json(originErr);
        return res.status(signUpResult.status === 403 ? 403 : 400).json({
          error: signUpResult.error || 'Registration failed.',
          code: signUpResult.code,
        });
      }

      let neonResult = signUpResult;
      if (!signUpResult.user && !signUpResult.jwt && !signUpResult.signedSessionToken && !signUpResult.sessionToken) {
        neonResult = await neonSignInEmail(normalizedEmail, password, clientOrigin);
        if (!neonResult.ok) {
          return res.status(400).json({
            error: neonResult.error || 'Account created but sign-in failed. Try signing in.',
          });
        }
      }

      const identity = await resolveIdentityFromNeonAuthResult(neonResult);
      if (!identity) {
        return res.status(502).json({
          error: 'Registration succeeded but user identity could not be resolved.',
        });
      }

      const session = await createNeonApiSession(pool, config, identity, name);
      if (session.error) {
        return res.status(session.status || 500).json({ error: session.error });
      }
      return res.status(201).json(session);
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json(authMigrationErrorPayload(err));
      }
      console.error('[auth neon-register]', err);
      res.status(500).json({ error: 'Failed to register with Neon Auth.' });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, full_name: fullName } = req.body || {};
      const normalizedEmail = normalizeEmail(email);
      const name = String(fullName || '').trim();
      if (!normalizedEmail || !password || password.length < 8) {
        return res.status(400).json({ error: 'Email and password (min 8 characters) are required.' });
      }
      if (!name) {
        return res.status(400).json({ error: 'Full name is required.' });
      }

      const domainCheck = await checkEmailDomainAllowed(pool, normalizedEmail);
      if (!domainCheck.allowed) {
        return res.status(403).json({ error: domainCheck.message });
      }

      const userCount = await pool.query('SELECT COUNT(*)::int AS n FROM public.api_users');
      const isFirstUser = (userCount.rows[0]?.n ?? 0) === 0;
      if (!isFirstUser && !config.registrationOpen) {
        return res.status(403).json({
          error: 'Registration is closed. Ask an administrator to create your account or use bootstrap with admin key.',
        });
      }

      const passwordHash = await bcrypt.hash(String(password), 12);
      const r = await pool.query(
        `INSERT INTO public.api_users (email, password_hash, full_name, is_admin)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, full_name, is_admin, created_at`,
        [normalizedEmail, passwordHash, name, isFirstUser]
      );
      const user = r.rows[0];
      res.status(201).json({
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          is_admin: user.is_admin,
        },
        message: isFirstUser ? 'Account created as administrator.' : 'Account created. Please sign in.',
      });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      if (err.code === '42P01') {
        return res.status(503).json({ error: 'Auth tables not found. Run migration 026 on Neon.' });
      }
      console.error('[auth register]', err);
      res.status(500).json({ error: 'Registration failed.' });
    }
  });

  app.post('/api/auth/bootstrap', async (req, res) => {
    if (!requireAdminAuth || !requireAdminAuth(req, res)) return;
    try {
      const { email, password, full_name: fullName } = req.body || {};
      const normalizedEmail = normalizeEmail(email);
      const name = String(fullName || '').trim();
      if (!normalizedEmail || !password || password.length < 8 || !name) {
        return res.status(400).json({ error: 'Email, full name, and password (min 8 characters) are required.' });
      }
      const domainCheck = await checkEmailDomainAllowed(pool, normalizedEmail);
      if (!domainCheck.allowed) {
        return res.status(403).json({ error: domainCheck.message });
      }
      const passwordHash = await bcrypt.hash(String(password), 12);
      const r = await pool.query(
        `INSERT INTO public.api_users (email, password_hash, full_name, is_admin)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           is_admin = TRUE,
           updated_at = NOW()
         RETURNING id, email, full_name, is_admin`,
        [normalizedEmail, passwordHash, name]
      );
      res.json({ user: r.rows[0], message: 'Admin user created or updated.' });
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json({ error: 'Auth tables not found. Run migration 026 on Neon.' });
      }
      console.error('[auth bootstrap]', err);
      res.status(500).json({ error: 'Bootstrap failed.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body || {};
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      const domainCheck = await checkEmailDomainAllowed(pool, normalizedEmail);
      if (!domainCheck.allowed) {
        return res.status(403).json({ error: domainCheck.message });
      }

      const r = await pool.query(
        'SELECT id, email, full_name, password_hash, is_admin FROM public.api_users WHERE email = $1',
        [normalizedEmail]
      );
      if (r.rows.length === 0) {
        maybeNotifyLoginSecurity(pool, req, normalizedEmail);
        return res.status(401).json({
          error: 'Invalid email or password.',
          ...getLoginRateLimitInfo(req),
        });
      }
      const user = r.rows[0];
      const match = await bcrypt.compare(String(password), user.password_hash);
      if (!match) {
        maybeNotifyLoginSecurity(pool, req, normalizedEmail);
        return res.status(401).json({
          error: 'Invalid email or password.',
          ...getLoginRateLimitInfo(req),
        });
      }

      const rawToken = generateSessionToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000);
      await pool.query(
        'INSERT INTO public.api_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, tokenHash, expiresAt]
      );

      res.json({
        token: rawToken,
        expires_at: expiresAt.toISOString(),
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          is_admin: user.is_admin,
          role: 'VIEWER',
        },
      });
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json({ error: 'Auth tables not found. Run migration 026 on Neon.' });
      }
      console.error('[auth login]', err);
      res.status(500).json({ error: 'Login failed.' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const rawToken = getBearerOrQueryToken(req);
      if (rawToken.startsWith(SESSION_PREFIX)) {
        await pool.query('DELETE FROM public.api_sessions WHERE token_hash = $1', [hashToken(rawToken)]);
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('[auth logout]', err);
      res.status(500).json({ error: 'Logout failed.' });
    }
  });

  app.get('/api/auth/me', async (req, res) => {
    try {
      const rawToken = getBearerOrQueryToken(req);
      const auth = await resolveAuth(pool, rawToken);
      if (!auth || auth.type !== 'user') {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      res.json({
        user: {
          id: auth.userId,
          email: auth.email,
          full_name: auth.fullName,
          is_admin: auth.isAdmin,
          role: 'VIEWER',
        },
      });
    } catch (err) {
      console.error('[auth me]', err);
      res.status(500).json({ error: 'Failed to load session.' });
    }
  });

  // Integration tokens — admin key or authenticated admin user
  app.get('/api/admin/integration-tokens', async (req, res) => {
    if (!req.auth?.isAdmin && (!requireAdminAuth || !requireAdminAuth(req, res))) return;
    try {
      const r = await pool.query(
        `SELECT id, name, token_prefix, scopes, event_id, expires_at, revoked_at, created_at, last_used_at
         FROM public.api_integration_tokens
         ORDER BY created_at DESC`
      );
      res.json({ tokens: r.rows });
    } catch (err) {
      if (err.code === '42P01') return res.json({ tokens: [], needsMigration: true });
      console.error('[integration-tokens GET]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/integration-tokens', async (req, res) => {
    if (!req.auth?.isAdmin && (!requireAdminAuth || !requireAdminAuth(req, res))) return;
    try {
      const { name, scopes, event_id: eventId, expires_in_days: expiresInDays } = req.body || {};
      const tokenName = String(name || '').trim();
      if (!tokenName) {
        return res.status(400).json({ error: 'Token name is required.' });
      }
      const scopeList = Array.isArray(scopes)
        ? scopes.map((s) => String(s).trim()).filter((s) => VALID_SCOPES.has(s))
        : ['read', 'control'];
      if (scopeList.length === 0) {
        return res.status(400).json({ error: 'At least one valid scope is required.', validScopes: [...VALID_SCOPES] });
      }

      const rawToken = generateIntegrationToken();
      const tokenHash = hashToken(rawToken);
      const prefix = tokenPrefix(rawToken);
      let expiresAt = null;
      if (expiresInDays && Number(expiresInDays) > 0) {
        expiresAt = new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000);
      }

      const createdBy =
        req.auth?.type === 'user' || req.auth?.type === 'neon_user' ? req.auth.userId : null;
      const r = await pool.query(
        `INSERT INTO public.api_integration_tokens (name, token_hash, token_prefix, scopes, event_id, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, token_prefix, scopes, event_id, expires_at, created_at`,
        [tokenName, tokenHash, prefix, scopeList, eventId || null, createdBy, expiresAt]
      );

      res.status(201).json({
        token: rawToken,
        record: r.rows[0],
        message: 'Copy this token now — it will not be shown again.',
      });
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json({ error: 'Auth tables not found. Run migration 026 on Neon.' });
      }
      console.error('[integration-tokens POST]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/admin/integration-tokens/:id', async (req, res) => {
    if (!req.auth?.isAdmin && (!requireAdminAuth || !requireAdminAuth(req, res))) return;
    try {
      const { id } = req.params;
      await pool.query(
        'UPDATE public.api_integration_tokens SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL',
        [id]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error('[integration-tokens DELETE]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/access-requests', async (req, res) => {
    if (!req.auth?.isAdmin && (!requireAdminAuth || !requireAdminAuth(req, res))) return;
    try {
      const status = String(req.query.status || 'pending').toLowerCase();
      const allowed = new Set(['pending', 'approved', 'rejected', 'all']);
      const filter = allowed.has(status) ? status : 'pending';
      let eventAccessNeedsMigration = false;
      let dashboardNeedsMigration = false;
      let r;
      const selectWithDashboard = (statusFilter) => {
        const eventJoin = `
                 LEFT JOIN (
                   SELECT access_id, COUNT(*)::int AS n
                   FROM public.api_user_event_access
                   GROUP BY access_id
                 ) ea_counts ON ea_counts.access_id = a.id`;
        const baseSelect = `SELECT a.id, a.neon_user_id, a.email, a.full_name, a.status, a.is_admin, a.dashboard_enabled, a.requested_at, a.reviewed_at, a.reviewed_by, a.notes, a.password_set_at, a.portal_token,
                        COALESCE(ea_counts.n, 0)::int AS event_access_count
                 FROM public.api_user_access a${eventJoin}`;
        if (statusFilter == null) {
          return pool.query(`${baseSelect} ORDER BY a.requested_at DESC`);
        }
        return pool.query(`${baseSelect} WHERE a.status = $1 ORDER BY a.requested_at DESC`, [statusFilter]);
      };
      const selectWithoutDashboard = (statusFilter) => {
        const baseSelect = `SELECT id, neon_user_id, email, full_name, status, is_admin, requested_at, reviewed_at, reviewed_by, notes, password_set_at, portal_token
                 FROM public.api_user_access`;
        if (statusFilter == null) {
          return pool.query(`${baseSelect} ORDER BY requested_at DESC`);
        }
        return pool.query(`${baseSelect} WHERE status = $1 ORDER BY requested_at DESC`, [statusFilter]);
      };
      try {
        r = await selectWithDashboard(filter === 'all' ? null : filter);
      } catch (joinErr) {
        if (isUndefinedColumnError(joinErr, 'dashboard_enabled')) {
          dashboardNeedsMigration = true;
          r = await selectWithoutDashboard(filter === 'all' ? null : filter);
        } else if (joinErr.code === '42P01') {
          eventAccessNeedsMigration = true;
          r = await selectWithoutDashboard(filter === 'all' ? null : filter);
        } else {
          throw joinErr;
        }
      }
      const origin = getAppPublicOrigin(req);
      const requests = [];
      for (const row of r.rows) {
        const portalToken = row.portal_token
          ? String(row.portal_token).trim()
          : await ensurePortalToken(pool, row.id);
        requests.push({
          ...row,
          dashboard_enabled: row.dashboard_enabled === true,
          event_access_count: row.event_access_count ?? 0,
          portal_url: buildAccessPortalUrl(origin, portalToken),
        });
      }
      res.json({ requests, eventAccessNeedsMigration, dashboardNeedsMigration });
    } catch (err) {
      if (err.code === '42P01') return res.json({ requests: [], needsMigration: true });
      console.error('[access-requests GET]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/access-requests/:id/approve', async (req, res) => {
    if (!req.auth?.isAdmin && (!requireAdminAuth || !requireAdminAuth(req, res))) return;
    try {
      const { id } = req.params;
      const makeAdmin = !!(req.body && req.body.make_admin);
      const reviewedBy = req.auth?.email || req.auth?.userId || 'admin';
      const r = await pool.query(
        `UPDATE public.api_user_access
         SET status = 'approved', is_admin = CASE WHEN $2 THEN TRUE ELSE is_admin END,
             reviewed_at = NOW(), reviewed_by = $3
         WHERE id = $1
         RETURNING *`,
        [id, makeAdmin, reviewedBy]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: 'Request not found.' });
      const request = r.rows[0];
      const portalToken = await ensurePortalToken(pool, request.id);
      const portalUrl = buildAccessPortalUrl(getAppPublicOrigin(req), portalToken);
      notifyUserAccessApproved({
        email: request.email,
        fullName: request.full_name,
        isAdmin: !!request.is_admin,
        portalUrl,
      }).catch((err) => console.error('[admin-notify-email]', err.message));
      res.json({ ok: true, request, portalUrl });
    } catch (err) {
      console.error('[access-requests approve]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/access-requests/:id/reject', async (req, res) => {
    if (!req.auth?.isAdmin && (!requireAdminAuth || !requireAdminAuth(req, res))) return;
    try {
      const { id } = req.params;
      const notes = String((req.body && req.body.notes) || '').trim() || null;
      const reviewedBy = req.auth?.email || req.auth?.userId || 'admin';
      const r = await pool.query(
        `UPDATE public.api_user_access
         SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $2, notes = $3
         WHERE id = $1
         RETURNING *`,
        [id, reviewedBy, notes]
      );
      if (r.rows.length === 0) return res.status(404).json({ error: 'Request not found.' });
      const request = r.rows[0];
      const portalToken = await ensurePortalToken(pool, request.id);
      const portalUrl = buildAccessPortalUrl(getAppPublicOrigin(req), portalToken);
      notifyUserAccessRejected({
        email: request.email,
        fullName: request.full_name,
        notes: request.notes,
        portalUrl,
      }).catch((err) => console.error('[admin-notify-email]', err.message));
      res.json({ ok: true, request });
    } catch (err) {
      console.error('[access-requests reject]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/admin/access-requests/:id', async (req, res) => {
    if (!req.auth?.isAdmin && (!requireAdminAuth || !requireAdminAuth(req, res))) return;
    try {
      const { id } = req.params;
      const body = req.body || {};
      const reviewedBy = req.auth?.email || req.auth?.userId || 'admin';

      const existingRes = await pool.query(`SELECT * FROM public.api_user_access WHERE id = $1`, [id]);
      if (existingRes.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
      const existing = existingRes.rows[0];

      const updates = [];
      const values = [];
      let param = 1;

      if (body.status !== undefined) {
        const status = String(body.status).toLowerCase();
        if (!['pending', 'approved', 'rejected'].includes(status)) {
          return res.status(400).json({ error: 'Status must be pending, approved, or rejected.' });
        }
        updates.push(`status = $${param++}`);
        values.push(status);
        if (status === 'pending') {
          updates.push('reviewed_at = NULL', 'reviewed_by = NULL');
          if (body.reset_account) {
            updates.push('neon_user_id = NULL', 'password_set_at = NULL');
          }
        } else {
          updates.push(`reviewed_at = NOW()`, `reviewed_by = $${param++}`);
          values.push(reviewedBy);
        }
      }

      if (body.is_admin !== undefined) {
        updates.push(`is_admin = $${param++}`);
        values.push(parseBoolBody(body.is_admin));
      }

      if (body.dashboard_enabled !== undefined) {
        updates.push(`dashboard_enabled = $${param++}`);
        values.push(parseBoolBody(body.dashboard_enabled));
      }

      if (body.notes !== undefined) {
        const notes = String(body.notes || '').trim() || null;
        updates.push(`notes = $${param++}`);
        values.push(notes);
      }

      if (updates.length === 0) {
        const keys = Object.keys(body).filter((k) => body[k] !== undefined);
        return res.status(400).json({
          error:
            keys.includes('dashboard_enabled') || keys.includes('dashboardEnabled')
              ? 'Dashboard access is not available on this API yet. Redeploy Railway with the latest code and run migration 032_add_dashboard_enabled.sql on Neon.'
              : 'No changes provided.',
        });
      }

      values.push(id);
      let r;
      try {
        r = await pool.query(
          `UPDATE public.api_user_access SET ${updates.join(', ')} WHERE id = $${param} RETURNING *`,
          values
        );
      } catch (updateErr) {
        if (isUndefinedColumnError(updateErr, 'dashboard_enabled')) {
          return res.status(503).json({
            error: 'Run migration 032_add_dashboard_enabled.sql on Neon to enable per-user dashboard access.',
          });
        }
        throw updateErr;
      }
      const request = r.rows[0];
      const notifyUser = body.notify_user !== false;
      const origin = getAppPublicOrigin(req);

      if (notifyUser && body.status === 'approved' && existing.status !== 'approved') {
        const portalToken = await ensurePortalToken(pool, request.id);
        const portalUrl = buildAccessPortalUrl(origin, portalToken);
        notifyUserAccessApproved({
          email: request.email,
          fullName: request.full_name,
          isAdmin: !!request.is_admin,
          portalUrl,
        }).catch((err) => console.error('[admin-notify-email]', err.message));
      } else if (notifyUser && body.status === 'rejected' && existing.status !== 'rejected') {
        const portalToken = await ensurePortalToken(pool, request.id);
        const portalUrl = buildAccessPortalUrl(origin, portalToken);
        notifyUserAccessRejected({
          email: request.email,
          fullName: request.full_name,
          notes: request.notes,
          portalUrl,
        }).catch((err) => console.error('[admin-notify-email]', err.message));
      }

      res.json({ ok: true, request });
    } catch (err) {
      console.error('[access-requests PATCH]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/admin/access-requests/:id', async (req, res) => {
    if (!req.auth?.isAdmin && (!requireAdminAuth || !requireAdminAuth(req, res))) return;
    try {
      const { id } = req.params;
      const r = await pool.query(`SELECT * FROM public.api_user_access WHERE id = $1`, [id]);
      if (r.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
      const row = r.rows[0];

      if (row.is_admin && row.status === 'approved') {
        const adminCount = await pool.query(
          `SELECT COUNT(*)::int AS n FROM public.api_user_access WHERE status = 'approved' AND is_admin = TRUE`
        );
        if ((adminCount.rows[0]?.n ?? 0) <= 1) {
          return res.status(400).json({ error: 'Cannot delete the last approved administrator.' });
        }
      }

      const actorEmail = normalizeEmail(req.auth?.email || '');
      if (actorEmail && actorEmail === normalizeEmail(row.email)) {
        return res.status(400).json({ error: 'You cannot delete your own access record.' });
      }

      if (row.neon_user_id) {
        await pool.query(`DELETE FROM public.api_neon_sessions WHERE neon_user_id = $1`, [row.neon_user_id]);
      }
      await pool.query(`DELETE FROM public.api_neon_sessions WHERE LOWER(email) = $1`, [normalizeEmail(row.email)]);

      let neonAuthRemoved = { deleted: false };
      try {
        neonAuthRemoved = await deleteNeonAuthUser(pool, {
          email: row.email,
          neonUserId: row.neon_user_id,
        });
      } catch (neonErr) {
        console.error('[access-requests DELETE] Neon Auth cleanup failed:', neonErr.message);
        neonAuthRemoved = {
          deleted: false,
          reason: 'delete_failed',
          error: neonErr.message || 'Neon Auth cleanup failed.',
        };
      }

      await pool.query(`DELETE FROM public.api_user_access WHERE id = $1`, [id]);

      res.json({
        ok: true,
        deleted: { id: row.id, email: row.email },
        neon_auth_removed: neonAuthRemoved.deleted,
        neon_auth_method: neonAuthRemoved.method || null,
        neon_auth_error: neonAuthRemoved.error || null,
        hint: neonAuthRemoved.deleted
          ? `Access record, API sessions, and Neon Auth login were removed (${neonAuthRemoved.method || 'unknown'}).`
          : neonAuthRemoved.error
            ? `Access record and API sessions were removed, but Neon Auth cleanup failed: ${neonAuthRemoved.error}`
            : 'Access record and API sessions were removed. No Neon Auth login was found for this email.',
      });
    } catch (err) {
      if (err.code === '42P01') {
        return res.status(503).json({ error: 'Run migration 027 on Neon for access approval.' });
      }
      console.error('[access-requests DELETE]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/access-requests/:id/event-access', async (req, res) => {
    if (!req.auth?.isAdmin && (!requireAdminAuth || !requireAdminAuth(req, res))) return;
    try {
      const { id } = req.params;
      const accessRes = await pool.query(
        `SELECT id, email, full_name, is_admin FROM public.api_user_access WHERE id = $1`,
        [id]
      );
      if (accessRes.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
      const user = accessRes.rows[0];

      let eventIds = [];
      try {
        const r = await pool.query(
          `SELECT event_id FROM public.api_user_event_access WHERE access_id = $1 ORDER BY event_id`,
          [id]
        );
        eventIds = r.rows.map((row) => String(row.event_id));
      } catch (err) {
        if (err.code === '42P01') {
          return res.json({
            user,
            event_ids: [],
            unrestricted: true,
            events: [],
            needsMigration: true,
          });
        }
        throw err;
      }

      const eventsRes = await pool.query(
        `SELECT id, name, date FROM calendar_events ORDER BY date DESC`
      );
      const events = (eventsRes.rows || []).map((row) => ({
        id: String(row.id),
        name: row.name,
        date:
          row.date instanceof Date
            ? row.date.toISOString().slice(0, 10)
            : String(row.date || '').slice(0, 10),
      }));

      res.json({
        user,
        event_ids: eventIds,
        unrestricted: eventIds.length === 0,
        events,
      });
    } catch (err) {
      console.error('[access-requests event-access GET]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/admin/access-requests/:id/event-access', async (req, res) => {
    if (!req.auth?.isAdmin && (!requireAdminAuth || !requireAdminAuth(req, res))) return;
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const body = req.body || {};
      if (!Array.isArray(body.event_ids)) {
        return res.status(400).json({ error: 'event_ids must be an array.' });
      }

      const accessRes = await client.query(`SELECT id FROM public.api_user_access WHERE id = $1`, [id]);
      if (accessRes.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

      const uniqueIds = [
        ...new Set(body.event_ids.map((value) => String(value).trim()).filter(Boolean)),
      ];

      await client.query('BEGIN');
      await client.query(`DELETE FROM public.api_user_event_access WHERE access_id = $1`, [id]);
      if (uniqueIds.length > 0) {
        await client.query(
          `INSERT INTO public.api_user_event_access (access_id, event_id)
           SELECT $1, unnest($2::text[])`,
          [id, uniqueIds]
        );
      }
      await client.query('COMMIT');

      res.json({
        ok: true,
        event_ids: uniqueIds,
        unrestricted: uniqueIds.length === 0,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '42P01') {
        return res.status(503).json({ error: 'Run migration 031 on Neon for per-user event access.' });
      }
      console.error('[access-requests event-access PUT]', err);
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });
}

module.exports = {
  loadApiAuthConfig,
  createApiAuthMiddleware,
  registerAuthRoutes,
  resolveAuth,
  getBearerOrQueryToken,
  getApiPathname,
  isPublicGraphicsFeedPath,
  hashToken,
  generateIntegrationToken,
  userCanAccessEvent,
  userCanAccessDashboard,
  filterCalendarEventsForAuth,
  VALID_SCOPES,
  SESSION_PREFIX,
  INTEGRATION_PREFIX,
};
