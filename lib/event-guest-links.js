/**
 * Public guest view links — read-only event schedule for people who are not signed in.
 * Separate from allowlist share invites (event-share-access.js).
 */

const crypto = require('crypto');
const { getAppPublicOrigin } = require('./access-portal');

const GUEST_PREFIX = 'ros_guest_';

function hashGuestToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

function generateGuestToken() {
  return GUEST_PREFIX + crypto.randomBytes(24).toString('hex');
}

function isGuestToken(token) {
  return typeof token === 'string' && token.startsWith(GUEST_PREFIX) && token.length > GUEST_PREFIX.length + 16;
}

function buildGuestEventUrl(origin, rawToken) {
  const base = (origin || 'http://localhost:3003').replace(/\/$/, '');
  return `${base}/guest?token=${encodeURIComponent(rawToken)}`;
}

function isMissingGuestTableError(err) {
  return err && (err.code === '42P01' || /api_event_guest_links/i.test(String(err.message || '')));
}

async function ensureGuestLinkSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.api_event_guest_links (
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
    ALTER TABLE public.api_event_guest_links
      ADD COLUMN IF NOT EXISTS token_raw TEXT
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_event_guest_links_event_id
      ON public.api_event_guest_links (event_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_event_guest_links_active
      ON public.api_event_guest_links (event_id)
      WHERE revoked_at IS NULL
  `);
}

async function createGuestLinkWithRaw(pool, { eventId, accessId, req }) {
  const rawToken = generateGuestToken();
  const tokenHash = hashGuestToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 16);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE public.api_event_guest_links
       SET revoked_at = NOW()
       WHERE event_id = $1 AND revoked_at IS NULL`,
      [String(eventId)]
    );
    try {
      await client.query(
        `INSERT INTO public.api_event_guest_links
           (event_id, token_hash, token_prefix, token_raw, created_by_access_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [String(eventId), tokenHash, tokenPrefix, rawToken, accessId || null]
      );
    } catch (err) {
      if (err.code === '42703') {
        await client.query(
          `INSERT INTO public.api_event_guest_links
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
    guestUrl: buildGuestEventUrl(getAppPublicOrigin(req), rawToken),
    createdAt: new Date().toISOString(),
    reused: false,
  };
}

async function ensureGuestLink(pool, { eventId, accessId, req, rotate = false }) {
  if (!rotate) {
    const existing = await pool.query(
      `SELECT token_raw, created_at
       FROM public.api_event_guest_links
       WHERE event_id = $1 AND revoked_at IS NULL AND token_raw IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [String(eventId)]
    );
    if (existing.rows[0]?.token_raw) {
      const rawToken = String(existing.rows[0].token_raw);
      return {
        rawToken,
        guestUrl: buildGuestEventUrl(getAppPublicOrigin(req), rawToken),
        createdAt: existing.rows[0].created_at,
        reused: true,
      };
    }
  }
  return createGuestLinkWithRaw(pool, { eventId, accessId, req });
}

async function lookupGuestByToken(pool, rawToken) {
  if (!isGuestToken(rawToken)) return null;
  const tokenHash = hashGuestToken(rawToken);
  const r = await pool.query(
    `SELECT id, event_id, created_at, revoked_at
     FROM public.api_event_guest_links
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );
  return r.rows[0] || null;
}

async function touchGuestLinkUsed(pool, guestId) {
  await pool
    .query(`UPDATE public.api_event_guest_links SET last_used_at = NOW() WHERE id = $1`, [guestId])
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

function sanitizeScheduleItem(item) {
  if (!item || typeof item !== 'object') return null;
  const custom = item.customFields && typeof item.customFields === 'object' ? item.customFields : {};
  return {
    id: item.id,
    day: item.day || 1,
    segmentName: item.segmentName || '',
    programType: item.programType || '',
    shotType: item.shotType || '',
    durationHours: item.durationHours ?? 0,
    durationMinutes: item.durationMinutes ?? 0,
    durationSeconds: item.durationSeconds ?? 0,
    speakers: typeof item.speakers === 'string' ? item.speakers : '',
    speakersText: typeof item.speakersText === 'string' ? item.speakersText : '',
    notes: typeof item.notes === 'string' ? item.notes : '',
    assets: typeof item.assets === 'string' ? item.assets : '',
    customFields: custom,
    cue: custom.cue || '',
    isIndented: !!item.isIndented,
    hasPPT: !!item.hasPPT,
    hasQA: !!item.hasQA,
    needsRecording: !!item.needsRecording,
    isPublic: !!item.isPublic,
  };
}

async function loadGuestEventPayload(pool, eventId) {
  let calendar;
  try {
    const cal = await pool.query(
      `SELECT id, name, date, schedule_data FROM calendar_events
       WHERE id = $1 AND deleted_at IS NULL`,
      [String(eventId)]
    );
    calendar = cal.rows[0];
  } catch (err) {
    if (err.code === '42703') {
      const cal = await pool.query(`SELECT id, name, date, schedule_data FROM calendar_events WHERE id = $1`, [
        String(eventId),
      ]);
      calendar = cal.rows[0];
    } else {
      throw err;
    }
  }
  if (!calendar) return null;

  const scheduleData = parseJsonMaybe(calendar.schedule_data, {}) || {};
  const date =
    calendar.date instanceof Date
      ? `${calendar.date.getFullYear()}-${String(calendar.date.getMonth() + 1).padStart(2, '0')}-${String(
          calendar.date.getDate()
        ).padStart(2, '0')}`
      : String(calendar.date || '').slice(0, 10);

  let scheduleItems = [];
  let numberOfDays = 1;
  let masterStartTime = '';
  let dayStartTimes = {};
  try {
    const ros = await pool.query(
      `SELECT schedule_items, settings FROM run_of_show_data WHERE event_id = $1`,
      [String(eventId)]
    );
    if (ros.rows[0]) {
      const items = parseJsonMaybe(ros.rows[0].schedule_items, []);
      scheduleItems = Array.isArray(items) ? items : [];
      const settings = parseJsonMaybe(ros.rows[0].settings, {}) || {};
      const days = Number(settings.numberOfDays ?? scheduleData.numberOfDays ?? 1);
      numberOfDays = Number.isFinite(days) && days > 0 ? days : 1;
      masterStartTime = typeof settings.masterStartTime === 'string' ? settings.masterStartTime : '';
      dayStartTimes =
        settings.dayStartTimes && typeof settings.dayStartTimes === 'object' ? settings.dayStartTimes : {};
    }
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }

  try {
    const indented = await pool.query(`SELECT item_id FROM indented_cues WHERE event_id = $1`, [String(eventId)]);
    const indentedIds = new Set(indented.rows.map((r) => String(r.item_id)));
    if (indentedIds.size > 0) {
      scheduleItems = scheduleItems.map((item) => ({
        ...item,
        isIndented: !!(item.isIndented || indentedIds.has(String(item.id))),
      }));
    }
  } catch (err) {
    if (err.code !== '42P01') {
      /* ignore indent merge failures */
    }
  }

  let activeTimer = null;
  try {
    const timers = await pool.query(
      `SELECT item_id, timer_state, is_active, is_running, started_at, duration_seconds, cue_is,
        CASE
          WHEN is_running = true AND started_at IS NOT NULL AND started_at < TIMESTAMPTZ '2090-01-01'
          THEN EXTRACT(EPOCH FROM (NOW() - started_at))::integer
          ELSE COALESCE(elapsed_seconds, 0)
        END AS elapsed_seconds
       FROM active_timers WHERE event_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [String(eventId)]
    );
    if (timers.rows[0]) {
      const t = timers.rows[0];
      activeTimer = {
        itemId: t.item_id,
        timerState: t.timer_state,
        isActive: !!t.is_active,
        isRunning: !!t.is_running,
        durationSeconds: t.duration_seconds,
        elapsedSeconds: t.elapsed_seconds,
        cueIs: t.cue_is || '',
      };
    }
  } catch (err) {
    if (err.code !== '42P01') {
      /* ignore */
    }
  }

  return {
    event: {
      id: String(calendar.id),
      name: calendar.name || 'Untitled event',
      date,
      location: scheduleData.location || '',
      numberOfDays,
      masterStartTime,
      dayStartTimes,
    },
    scheduleItems: scheduleItems.map(sanitizeScheduleItem).filter(Boolean),
    activeTimer,
    serverTime: new Date().toISOString(),
  };
}

module.exports = {
  GUEST_PREFIX,
  hashGuestToken,
  generateGuestToken,
  isGuestToken,
  buildGuestEventUrl,
  isMissingGuestTableError,
  ensureGuestLinkSchema,
  ensureGuestLink,
  createGuestLinkWithRaw,
  lookupGuestByToken,
  touchGuestLinkUsed,
  loadGuestEventPayload,
  sanitizeScheduleItem,
};
