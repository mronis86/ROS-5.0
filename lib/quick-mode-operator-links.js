/**
 * Public Quick Mode operator links — stable token per session; access gated by expires_at.
 * Unsigned users with a non-expired token can control timers for that Quick Mode event only.
 */

const crypto = require('crypto');
const { getAppPublicOrigin } = require('./access-portal');

const QM_OP_PREFIX = 'ros_qmop_';
const DEFAULT_HOURS = 8;

function hashQmOpToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

function generateQmOpToken() {
  return QM_OP_PREFIX + crypto.randomBytes(24).toString('hex');
}

function isQmOpToken(token) {
  return typeof token === 'string' && token.startsWith(QM_OP_PREFIX) && token.length > QM_OP_PREFIX.length + 16;
}

function buildQmOpUrl(origin, eventId, rawToken) {
  const base = (origin || 'http://localhost:3003').replace(/\/$/, '');
  const eid = encodeURIComponent(String(eventId || ''));
  const op = encodeURIComponent(String(rawToken || ''));
  return `${base}/quick-mode?eventId=${eid}&op=${op}`;
}

function isMissingQmOpTableError(err) {
  return err && (err.code === '42P01' || /api_quick_mode_operator_links/i.test(String(err.message || '')));
}

async function ensureQmOpLinkSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.api_quick_mode_operator_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      token_raw TEXT NOT NULL,
      created_by_access_id UUID REFERENCES public.api_user_access(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      last_used_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_qm_operator_links_token_hash
      ON public.api_quick_mode_operator_links (token_hash)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_qm_operator_links_expires
      ON public.api_quick_mode_operator_links (expires_at)
  `);
}

function parseScheduleData(scheduleData) {
  if (scheduleData == null) return {};
  if (typeof scheduleData === 'object') return scheduleData;
  try {
    return JSON.parse(scheduleData);
  } catch {
    return {};
  }
}

function isQuickModeEventRow(row) {
  if (!row) return false;
  const sd = parseScheduleData(row.schedule_data);
  return sd.quickMode === true || sd.source === 'quick-mode';
}

async function assertQuickModeEvent(pool, eventId) {
  let row;
  try {
    const r = await pool.query(
      `SELECT id, name, schedule_data FROM public.calendar_events
       WHERE id::text = $1 AND (deleted_at IS NULL)
       LIMIT 1`,
      [String(eventId)]
    );
    row = r.rows[0];
  } catch (err) {
    if (err.code === '42703') {
      const r = await pool.query(
        `SELECT id, name, schedule_data FROM public.calendar_events
         WHERE id::text = $1
         LIMIT 1`,
        [String(eventId)]
      );
      row = r.rows[0];
    } else {
      throw err;
    }
  }
  if (!row) return { ok: false, status: 404, error: 'Event not found.' };
  if (!isQuickModeEventRow(row)) {
    return { ok: false, status: 400, error: 'Public operator links are only for Quick Mode sessions.' };
  }
  return { ok: true, event: row };
}

function hoursFromNow(hours) {
  const h = Math.max(1, Math.min(168, Number(hours) || DEFAULT_HOURS));
  return new Date(Date.now() + h * 60 * 60 * 1000);
}

function linkPayload(row, req) {
  const active = row.expires_at && new Date(row.expires_at) > new Date();
  return {
    eventId: String(row.event_id),
    operatorUrl: buildQmOpUrl(getAppPublicOrigin(req), row.event_id, row.token_raw),
    token: row.token_raw,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at || null,
    active: !!active,
  };
}

async function getQmOpLinkByEvent(pool, eventId) {
  const r = await pool.query(
    `SELECT id, event_id, token_raw, created_at, expires_at, last_used_at
     FROM public.api_quick_mode_operator_links
     WHERE event_id = $1
     LIMIT 1`,
    [String(eventId)]
  );
  return r.rows[0] || null;
}

/**
 * Ensure a stable operator link exists. By default keeps the same token and only updates expires_at.
 * Pass rotate=true to mint a new token (breaks existing QR/bookmarks).
 */
async function ensureQmOpLink(pool, { eventId, accessId, req, hours = DEFAULT_HOURS, expireNow = false, rotate = false }) {
  const existing = await getQmOpLinkByEvent(pool, eventId);
  const expiresAt = expireNow ? new Date() : hoursFromNow(hours);

  if (existing && !rotate) {
    const r = await pool.query(
      `UPDATE public.api_quick_mode_operator_links
       SET expires_at = $2
       WHERE event_id = $1
       RETURNING id, event_id, token_raw, created_at, expires_at, last_used_at`,
      [String(eventId), expiresAt.toISOString()]
    );
    const row = r.rows[0] || existing;
    return { ...linkPayload(row, req), reused: true, rotated: false };
  }

  const rawToken = generateQmOpToken();
  const tokenHash = hashQmOpToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 16);

  if (existing && rotate) {
    const r = await pool.query(
      `UPDATE public.api_quick_mode_operator_links
       SET token_hash = $2, token_prefix = $3, token_raw = $4, expires_at = $5,
           created_by_access_id = COALESCE($6, created_by_access_id)
       WHERE event_id = $1
       RETURNING id, event_id, token_raw, created_at, expires_at, last_used_at`,
      [String(eventId), tokenHash, tokenPrefix, rawToken, expiresAt.toISOString(), accessId || null]
    );
    return { ...linkPayload(r.rows[0], req), reused: false, rotated: true };
  }

  const r = await pool.query(
    `INSERT INTO public.api_quick_mode_operator_links
       (event_id, token_hash, token_prefix, token_raw, created_by_access_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, event_id, token_raw, created_at, expires_at, last_used_at`,
    [String(eventId), tokenHash, tokenPrefix, rawToken, accessId || null, expiresAt.toISOString()]
  );
  return { ...linkPayload(r.rows[0], req), reused: false, rotated: false };
}

async function lookupQmOpByToken(pool, rawToken) {
  if (!isQmOpToken(rawToken)) return null;
  const tokenHash = hashQmOpToken(rawToken);
  const r = await pool.query(
    `SELECT id, event_id, token_raw, created_at, expires_at, last_used_at
     FROM public.api_quick_mode_operator_links
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );
  return r.rows[0] || null;
}

async function touchQmOpLinkUsed(pool, linkId) {
  await pool
    .query(`UPDATE public.api_quick_mode_operator_links SET last_used_at = NOW() WHERE id = $1`, [linkId])
    .catch(() => {});
}

function parseJsonMaybe(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function scheduleItemsToQuickTimers(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const id = Number(item.id) || index + 1;
      const hours = Number(item.durationHours) || 0;
      const minutes = Number(item.durationMinutes) || 0;
      const seconds = Number(item.durationSeconds) || 0;
      const durationMs = Math.max(1000, ((hours * 3600 + minutes * 60 + seconds) || 60) * 1000);
      const cue =
        (item.customFields && item.customFields.cue) ||
        item.cue ||
        `CUE ${id}`;
      return {
        id,
        title: String(item.segmentName || `Timer ${id}`),
        cue: String(cue),
        durationMs,
        remainingMs: durationMs,
        isRunning: false,
        startedAtMs: null,
      };
    })
    .filter(Boolean);
}

async function loadQmOpSessionPayload(pool, eventId) {
  const eventCheck = await assertQuickModeEvent(pool, eventId);
  if (!eventCheck.ok) return null;

  const ros = await pool.query(
    `SELECT event_id, event_name, schedule_items, settings
     FROM public.run_of_show_data
     WHERE event_id::text = $1
     LIMIT 1`,
    [String(eventId)]
  );
  const row = ros.rows[0];
  const scheduleItems = parseJsonMaybe(row?.schedule_items, []);
  return {
    eventId: String(eventId),
    eventName: row?.event_name || eventCheck.event.name || 'Quick Mode',
    timers: scheduleItemsToQuickTimers(scheduleItems),
    scheduleItems,
  };
}

/** Paths a Quick Mode operator token may use (scoped to its event_id). */
function isQmOpAllowedPath(pathname, method) {
  const m = String(method || '').toUpperCase();
  if (pathname === '/api/run-of-show-data' && (m === 'POST' || m === 'PUT')) return true;
  if (/^\/api\/run-of-show-data\/[0-9a-f-]{36}$/i.test(pathname) && (m === 'GET' || m === 'HEAD')) return true;
  if (pathname.startsWith('/api/active-timers')) return true;
  if (pathname.startsWith('/api/sub-cue-timers')) return true;
  if (pathname === '/api/timers/start' && m === 'POST') return true;
  if (pathname === '/api/timers/stop' && m === 'POST') return true;
  if (pathname === '/api/timers/reset' && m === 'POST') return true;
  return false;
}

function qmOpAccessAllowed(auth, pathname, method, requestEventId) {
  if (!auth || auth.type !== 'quick_mode_operator') return false;
  if (!isQmOpAllowedPath(pathname, method)) return false;
  const authEventId = String(auth.eventId || '');
  if (!authEventId) return false;
  if (requestEventId) {
    return String(requestEventId) === authEventId;
  }
  // GETs without event in path shouldn't happen for allowed routes; deny if we can't scope.
  const m = String(method || '').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return false;
  // Writes: event_id must be present in body/path — if missing, deny.
  return false;
}

module.exports = {
  QM_OP_PREFIX,
  DEFAULT_HOURS,
  isQmOpToken,
  isMissingQmOpTableError,
  ensureQmOpLinkSchema,
  assertQuickModeEvent,
  getQmOpLinkByEvent,
  ensureQmOpLink,
  lookupQmOpByToken,
  touchQmOpLinkUsed,
  loadQmOpSessionPayload,
  linkPayload,
  buildQmOpUrl,
  isQmOpAllowedPath,
  qmOpAccessAllowed,
  hoursFromNow,
};
