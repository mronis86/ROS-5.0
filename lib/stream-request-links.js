/**
 * Public Stream Request form links — collect YouTube channel / visibility / share-to
 * and merge into calendar_events.schedule_data.streamDetails.
 */

const crypto = require('crypto');
const { getAppPublicOrigin } = require('./access-portal');

const STREAM_REQUEST_PREFIX = 'ros_sreq_';

const YOUTUBE_CHANNEL_OPTIONS = [
  'US Chamber of Commerce',
  'USCC Foundation',
  'Hiring Our Heroes',
  'CO',
  'Other',
];

const VISIBILITY_OPTIONS = ['Public', 'Unlisted'];

function hashStreamRequestToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
}

function generateStreamRequestToken() {
  return STREAM_REQUEST_PREFIX + crypto.randomBytes(24).toString('hex');
}

function isStreamRequestToken(token) {
  return (
    typeof token === 'string' &&
    token.startsWith(STREAM_REQUEST_PREFIX) &&
    token.length > STREAM_REQUEST_PREFIX.length + 16
  );
}

function buildStreamRequestUrl(origin, rawToken) {
  const base = (origin || 'http://localhost:3003').replace(/\/$/, '');
  return `${base}/stream-request?token=${encodeURIComponent(rawToken)}`;
}

function isMissingStreamRequestTableError(err) {
  return err && (err.code === '42P01' || /api_event_stream_request_links/i.test(String(err.message || '')));
}

async function ensureStreamRequestLinkSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.api_event_stream_request_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      token_raw TEXT,
      created_by_access_id UUID REFERENCES public.api_user_access(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      last_used_at TIMESTAMPTZ,
      last_submitted_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_event_stream_request_links_event_id
      ON public.api_event_stream_request_links (event_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_event_stream_request_links_active
      ON public.api_event_stream_request_links (event_id)
      WHERE revoked_at IS NULL
  `);
}

async function createStreamRequestLinkWithRaw(pool, { eventId, accessId, req }) {
  const rawToken = generateStreamRequestToken();
  const tokenHash = hashStreamRequestToken(rawToken);
  const tokenPrefix = rawToken.slice(0, 16);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE public.api_event_stream_request_links
       SET revoked_at = NOW()
       WHERE event_id = $1 AND revoked_at IS NULL`,
      [String(eventId)]
    );
    await client.query(
      `INSERT INTO public.api_event_stream_request_links
         (event_id, token_hash, token_prefix, token_raw, created_by_access_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [String(eventId), tokenHash, tokenPrefix, rawToken, accessId || null]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return {
    rawToken,
    streamRequestUrl: buildStreamRequestUrl(getAppPublicOrigin(req), rawToken),
    createdAt: new Date().toISOString(),
    reused: false,
  };
}

async function ensureStreamRequestLink(pool, { eventId, accessId, req, rotate = false }) {
  if (!rotate) {
    const existing = await pool.query(
      `SELECT token_raw, created_at
       FROM public.api_event_stream_request_links
       WHERE event_id = $1 AND revoked_at IS NULL AND token_raw IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [String(eventId)]
    );
    if (existing.rows[0]?.token_raw) {
      const rawToken = String(existing.rows[0].token_raw);
      return {
        rawToken,
        streamRequestUrl: buildStreamRequestUrl(getAppPublicOrigin(req), rawToken),
        createdAt: existing.rows[0].created_at,
        reused: true,
      };
    }
  }
  return createStreamRequestLinkWithRaw(pool, { eventId, accessId, req });
}

async function lookupStreamRequestByToken(pool, rawToken) {
  const tokenHash = hashStreamRequestToken(rawToken);
  const result = await pool.query(
    `SELECT id, event_id, revoked_at, created_at, last_submitted_at
     FROM public.api_event_stream_request_links
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

async function touchStreamRequestLinkUsed(pool, linkId) {
  await pool.query(
    `UPDATE public.api_event_stream_request_links
     SET last_used_at = NOW()
     WHERE id = $1`,
    [linkId]
  );
}

async function touchStreamRequestSubmitted(pool, linkId) {
  await pool.query(
    `UPDATE public.api_event_stream_request_links
     SET last_used_at = NOW(), last_submitted_at = NOW()
     WHERE id = $1`,
    [linkId]
  );
}

function parseJsonMaybe(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

async function findCalendarRowForEvent(pool, eventId) {
  const id = String(eventId || '').trim();
  if (!id) return null;
  let result = await pool.query(
    `SELECT id, name, date, schedule_data FROM calendar_events
     WHERE schedule_data->>'eventId' = $1
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1`,
    [id]
  );
  if (result.rows[0]) return result.rows[0];
  result = await pool.query(
    `SELECT id, name, date, schedule_data FROM calendar_events WHERE id = $1 LIMIT 1`,
    [id]
  );
  return result.rows[0] || null;
}

async function loadStreamRequestFormPayload(pool, eventId) {
  const row = await findCalendarRowForEvent(pool, eventId);
  if (!row) return null;
  const scheduleData = parseJsonMaybe(row.schedule_data, {}) || {};
  const streamDetails = parseJsonMaybe(scheduleData.streamDetails, {}) || {};
  const date =
    row.date instanceof Date
      ? `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, '0')}-${String(row.date.getDate()).padStart(2, '0')}`
      : String(row.date || '').slice(0, 10);
  return {
    event: {
      id: String(scheduleData.eventId || row.id),
      name: row.name || 'Untitled event',
      date,
      location: scheduleData.location || '',
    },
    alreadySubmitted: !!(
      streamDetails.youtubeChannel ||
      streamDetails.visibility ||
      streamDetails.shareWith ||
      streamDetails.requestSubmittedAt
    ),
    existing: {
      youtubeChannel: streamDetails.youtubeChannel || '',
      youtubeChannelOther: streamDetails.youtubeChannelOther || '',
      visibility: streamDetails.visibility || '',
      shareWith: streamDetails.shareWith || '',
      requestContactName: streamDetails.requestContactName || '',
      requestContactEmail: streamDetails.requestContactEmail || '',
      requestSubmittedAt: streamDetails.requestSubmittedAt || '',
    },
    options: {
      youtubeChannels: YOUTUBE_CHANNEL_OPTIONS,
      visibilities: VISIBILITY_OPTIONS,
    },
  };
}

function normalizeStreamRequestBody(body) {
  const youtubeChannel = String(body?.youtubeChannel || '').trim();
  const youtubeChannelOther = String(body?.youtubeChannelOther || '').trim();
  const visibility = String(body?.visibility || '').trim();
  const shareWith = String(body?.shareWith || '').trim();
  const requestContactName = String(body?.requestContactName || body?.contactName || '').trim();
  const requestContactEmail = String(body?.requestContactEmail || body?.contactEmail || '').trim();

  if (!YOUTUBE_CHANNEL_OPTIONS.includes(youtubeChannel)) {
    return { error: 'Please select a YouTube channel.' };
  }
  if (youtubeChannel === 'Other' && !youtubeChannelOther) {
    return { error: 'Please specify the YouTube channel name.' };
  }
  if (!VISIBILITY_OPTIONS.includes(visibility)) {
    return { error: 'Please choose Public or Unlisted.' };
  }
  if (!shareWith) {
    return { error: 'Please tell us who should receive the player link.' };
  }

  return {
    youtubeChannel,
    youtubeChannelOther: youtubeChannel === 'Other' ? youtubeChannelOther : '',
    visibility,
    shareWith,
    requestContactName,
    requestContactEmail,
    requestSubmittedAt: new Date().toISOString(),
  };
}

async function applyStreamRequestToEvent(pool, eventId, requestFields) {
  const calendar = await findCalendarRowForEvent(pool, eventId);
  if (!calendar) return null;

  const scheduleData = parseJsonMaybe(calendar.schedule_data, {}) || {};
  const prevDetails = parseJsonMaybe(scheduleData.streamDetails, {}) || {};
  const nextDetails = {
    ...prevDetails,
    youtubeChannel: requestFields.youtubeChannel,
    youtubeChannelOther: requestFields.youtubeChannelOther,
    visibility: requestFields.visibility,
    shareWith: requestFields.shareWith,
    requestContactName: requestFields.requestContactName,
    requestContactEmail: requestFields.requestContactEmail,
    requestSubmittedAt: requestFields.requestSubmittedAt,
  };

  const recordStreaming = String(scheduleData.recordStreaming || '').trim();
  if (recordStreaming !== 'Streaming' && recordStreaming !== 'Stream+Rec') {
    scheduleData.recordStreaming = 'Streaming';
  }
  scheduleData.streamDetails = nextDetails;
  if (!scheduleData.eventId) scheduleData.eventId = String(eventId);

  await pool.query(
    `UPDATE calendar_events
     SET schedule_data = $1, updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(scheduleData), calendar.id]
  );

  return {
    eventId: String(eventId),
    calendarId: String(calendar.id),
    streamDetails: nextDetails,
  };
}

module.exports = {
  YOUTUBE_CHANNEL_OPTIONS,
  VISIBILITY_OPTIONS,
  isStreamRequestToken,
  isMissingStreamRequestTableError,
  ensureStreamRequestLinkSchema,
  ensureStreamRequestLink,
  lookupStreamRequestByToken,
  touchStreamRequestLinkUsed,
  touchStreamRequestSubmitted,
  loadStreamRequestFormPayload,
  normalizeStreamRequestBody,
  applyStreamRequestToEvent,
  buildStreamRequestUrl,
};
