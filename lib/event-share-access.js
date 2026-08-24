/**
 * Event share-access invite links — add an event to another user's allowlist.
 */

const crypto = require('crypto');
const { getAppPublicOrigin } = require('./access-portal');

const SHARE_PREFIX = 'ros_eshare_';

function hashShareToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

function generateShareToken() {
  return SHARE_PREFIX + crypto.randomBytes(24).toString('hex');
}

function isShareToken(token) {
  return typeof token === 'string' && token.startsWith(SHARE_PREFIX) && token.length > SHARE_PREFIX.length + 16;
}

function buildEventShareUrl(origin, rawToken) {
  const base = (origin || 'http://localhost:3003').replace(/\/$/, '');
  return `${base}/join-event?token=${encodeURIComponent(rawToken)}`;
}

function isMissingShareTableError(err) {
  return err && (err.code === '42P01' || /api_event_share_tokens/i.test(String(err.message || '')));
}

async function ensureEventShareSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.api_event_share_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      token_raw TEXT,
      created_by_access_id UUID REFERENCES public.api_user_access(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      last_used_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    ALTER TABLE public.api_event_share_tokens
      ADD COLUMN IF NOT EXISTS token_raw TEXT
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_event_share_tokens_event_id
      ON public.api_event_share_tokens (event_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_event_share_tokens_active
      ON public.api_event_share_tokens (event_id)
      WHERE revoked_at IS NULL
  `);
}

async function findActiveShareRow(pool, eventId) {
  const r = await pool.query(
    `SELECT id, event_id, token_hash, token_prefix, created_at
     FROM public.api_event_share_tokens
     WHERE event_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [String(eventId)]
  );
  return r.rows[0] || null;
}

/**
 * Create a new active share token for an event (revokes prior active tokens).
 * Returns { rawToken, shareUrl, createdAt }.
 */
async function createEventShareToken(pool, { eventId, accessId, req }) {
  const rawToken = generateShareToken();
  const tokenHash = hashShareToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 16);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE public.api_event_share_tokens
       SET revoked_at = NOW()
       WHERE event_id = $1 AND revoked_at IS NULL`,
      [String(eventId)]
    );
    await client.query(
      `INSERT INTO public.api_event_share_tokens
         (event_id, token_hash, token_prefix, created_by_access_id)
       VALUES ($1, $2, $3, $4)`,
      [String(eventId), tokenHash, tokenPrefix, accessId || null]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const origin = getAppPublicOrigin(req);
  return {
    rawToken,
    shareUrl: buildEventShareUrl(origin, rawToken),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Get existing active token URL when raw token is still stored? We only store hash,
 * so callers must create once and return raw to the creator. Subsequent "get" creates
 * a new token unless we persist the raw token. Prefer: always mint on demand OR
 * store raw token like portal_token.
 *
 * For UX "copy again", store raw token (like portal).
 */
async function ensureEventShareToken(pool, { eventId, accessId, req, rotate = false }) {
  if (!rotate) {
    const existing = await pool.query(
      `SELECT token_raw, created_at
       FROM public.api_event_share_tokens
       WHERE event_id = $1 AND revoked_at IS NULL AND token_raw IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [String(eventId)]
    );
    if (existing.rows[0]?.token_raw) {
      const rawToken = String(existing.rows[0].token_raw);
      return {
        rawToken,
        shareUrl: buildEventShareUrl(getAppPublicOrigin(req), rawToken),
        createdAt: existing.rows[0].created_at,
        reused: true,
      };
    }
  }
  return createEventShareTokenWithRaw(pool, { eventId, accessId, req });
}

async function createEventShareTokenWithRaw(pool, { eventId, accessId, req }) {
  const rawToken = generateShareToken();
  const tokenHash = hashShareToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 16);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE public.api_event_share_tokens
       SET revoked_at = NOW()
       WHERE event_id = $1 AND revoked_at IS NULL`,
      [String(eventId)]
    );
    // Prefer insert with token_raw; fall back if column missing until migration applied fully
    try {
      await client.query(
        `INSERT INTO public.api_event_share_tokens
           (event_id, token_hash, token_prefix, token_raw, created_by_access_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [String(eventId), tokenHash, tokenPrefix, rawToken, accessId || null]
      );
    } catch (err) {
      if (err.code === '42703') {
        await client.query(
          `INSERT INTO public.api_event_share_tokens
             (event_id, token_hash, token_prefix, created_by_access_id)
           VALUES ($1, $2, $3, $4)`,
          [String(eventId), tokenHash, tokenPrefix, accessId || null]
        );
      } else {
        throw err;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return {
    rawToken,
    shareUrl: buildEventShareUrl(getAppPublicOrigin(req), rawToken),
    createdAt: new Date().toISOString(),
    reused: false,
  };
}

async function lookupShareByToken(pool, rawToken) {
  if (!isShareToken(rawToken)) return null;
  const tokenHash = hashShareToken(rawToken);
  const r = await pool.query(
    `SELECT id, event_id, created_at, revoked_at
     FROM public.api_event_share_tokens
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );
  return r.rows[0] || null;
}

async function touchShareTokenUsed(pool, shareId) {
  await pool.query(
    `UPDATE public.api_event_share_tokens SET last_used_at = NOW() WHERE id = $1`,
    [shareId]
  ).catch(() => {});
}

/**
 * Append event to a restricted user's allowlist.
 * Unrestricted users (no rows) already see all events — do not convert them.
 */
async function appendEventToUserAllowlist(pool, accessId, eventId) {
  if (!accessId || !eventId) {
    return { status: 'error', message: 'Missing user or event.' };
  }
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM public.api_user_event_access WHERE access_id = $1`,
    [accessId]
  );
  const n = countRes.rows[0]?.n ?? 0;
  if (n === 0) {
    return { status: 'unrestricted', message: 'You already have access to all events.' };
  }
  const existing = await pool.query(
    `SELECT 1 FROM public.api_user_event_access WHERE access_id = $1 AND event_id = $2 LIMIT 1`,
    [accessId, String(eventId)]
  );
  if (existing.rows.length > 0) {
    return { status: 'already', message: 'This event is already on your list.' };
  }
  await pool.query(
    `INSERT INTO public.api_user_event_access (access_id, event_id)
     VALUES ($1, $2)
     ON CONFLICT (access_id, event_id) DO NOTHING`,
    [accessId, String(eventId)]
  );
  return { status: 'added', message: 'Event added to your list.' };
}

async function loadEventSummary(pool, eventId) {
  let result;
  try {
    result = await pool.query(
      `SELECT id, name, date, schedule_data FROM calendar_events
       WHERE id = $1 AND deleted_at IS NULL`,
      [String(eventId)]
    );
  } catch (err) {
    if (err.code === '42703') {
      result = await pool.query(
        `SELECT id, name, date FROM calendar_events WHERE id = $1`,
        [String(eventId)]
      );
    } else {
      throw err;
    }
  }
  const row = result.rows[0];
  if (!row) return null;
  const date =
    row.date instanceof Date
      ? `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, '0')}-${String(row.date.getDate()).padStart(2, '0')}`
      : String(row.date || '').slice(0, 10);
  return { id: String(row.id), name: row.name || 'Untitled event', date };
}

module.exports = {
  SHARE_PREFIX,
  hashShareToken,
  generateShareToken,
  isShareToken,
  buildEventShareUrl,
  isMissingShareTableError,
  ensureEventShareSchema,
  findActiveShareRow,
  ensureEventShareToken,
  createEventShareTokenWithRaw,
  lookupShareByToken,
  touchShareTokenUsed,
  appendEventToUserAllowlist,
  loadEventSummary,
};
