/**
 * Per-event audience engagement — one public link/QR for live Q&A + polls.
 */

const crypto = require('crypto');
const webQa = require('./web-qa');
const webPolls = require('./web-polls');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function newPublicToken() {
  return crypto.randomBytes(12).toString('base64url');
}

async function ensureEngagementSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.event_engagement_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL UNIQUE,
      public_token TEXT NOT NULL UNIQUE,
      title TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_event_engagement_sessions_token
      ON public.event_engagement_sessions (public_token)
  `);
}

async function getOrCreateEngagementSession(db, eventId, title) {
  await ensureEngagementSchema(db);
  const event_id = String(eventId || '').trim();
  if (!event_id) throw httpError(400, 'eventId is required');
  const existing = await db.query(
    `SELECT id, event_id, public_token, title, created_at, updated_at
     FROM public.event_engagement_sessions
     WHERE event_id = $1
     LIMIT 1`,
    [event_id]
  );
  if (existing.rows[0]) {
    if (title && title !== existing.rows[0].title) {
      const updated = await db.query(
        `UPDATE public.event_engagement_sessions
         SET title = $2, updated_at = NOW()
         WHERE event_id = $1
         RETURNING id, event_id, public_token, title, created_at, updated_at`,
        [event_id, String(title).trim().slice(0, 200)]
      );
      return updated.rows[0] || existing.rows[0];
    }
    return existing.rows[0];
  }
  const token = newPublicToken();
  const inserted = await db.query(
    `INSERT INTO public.event_engagement_sessions (event_id, public_token, title)
     VALUES ($1, $2, $3)
     RETURNING id, event_id, public_token, title, created_at, updated_at`,
    [event_id, token, title ? String(title).trim().slice(0, 200) : null]
  );
  return inserted.rows[0];
}

async function getEngagementSessionByToken(db, token) {
  await ensureEngagementSchema(db);
  const r = await db.query(
    `SELECT id, event_id, public_token, title, created_at, updated_at
     FROM public.event_engagement_sessions
     WHERE public_token = $1
     LIMIT 1`,
    [String(token || '').trim()]
  );
  return r.rows[0] || null;
}

async function rotateEngagementSessionToken(db, eventId) {
  const event_id = String(eventId || '').trim();
  await getOrCreateEngagementSession(db, event_id);
  const token = newPublicToken();
  const r = await db.query(
    `UPDATE public.event_engagement_sessions
     SET public_token = $2, updated_at = NOW()
     WHERE event_id = $1
     RETURNING id, event_id, public_token, title, created_at, updated_at`,
    [event_id, token]
  );
  if (!r.rows[0]) throw httpError(404, 'Engagement session not found');
  return r.rows[0];
}

/**
 * Resolve engagement / legacy poll / legacy Q&A public token → event session.
 */
async function resolveEngagementByAnyToken(db, token) {
  const t = String(token || '').trim();
  if (!t) throw httpError(400, 'token is required');

  await ensureEngagementSchema(db);
  let session = await getEngagementSessionByToken(db, t);
  if (session) return session;

  // Legacy poll event QR
  try {
    await webPolls.ensureWebPollsSchema(db);
    const pollSession = await webPolls.getPollSessionByToken(db, t);
    if (pollSession?.event_id) {
      return getOrCreateEngagementSession(db, pollSession.event_id, pollSession.title);
    }
  } catch {
    /* ignore */
  }

  // Legacy Q&A QR
  try {
    await webQa.ensureWebQaSchema(db);
    const qaSession = await webQa.getSessionByToken(db, t);
    if (qaSession?.event_id) {
      return getOrCreateEngagementSession(db, qaSession.event_id, qaSession.title);
    }
  } catch {
    /* ignore */
  }

  throw httpError(404, 'Invalid engagement link');
}

async function getPublicEngagement(db, token) {
  const session = await resolveEngagementByAnyToken(db, token);
  const eventId = session.event_id;
  const title = session.title || 'Live engagement';

  let qa = null;
  let show_qa = false;
  try {
    await webQa.ensureWebQaSchema(db);
    const sync = await webQa.syncSessionOpenFromCue(db, eventId, title);
    const soft = await webQa.getSoftLimitState(db, eventId);
    const cue = sync.context?.current_cue || null;
    const inQa = sync.context?.in_qa_cue === true;
    show_qa = inQa === true;
    qa = {
      public_token: sync.session.public_token,
      is_open: sync.session.is_open === true,
      in_qa_cue: inQa,
      at_soft_limit: soft.at_soft_limit === true,
      soft_limit: soft.soft_limit,
      current_cue: cue
        ? {
            id: cue.id,
            cue: cue.cue || null,
            segment_name: cue.segment_name || null,
            has_qa: cue.has_qa === true,
          }
        : null,
    };
  } catch (err) {
    console.warn('[engagement] qa slice skipped:', err.message || err);
  }

  let poll = null;
  let show_poll = false;
  try {
    await webPolls.ensureWebPollsSchema(db);
    const pollSession = await webPolls.getOrCreatePollSession(db, eventId, title);
    const pollPublic = await webPolls.getPublicEventPolls(db, pollSession.public_token);
    const open = pollPublic.open_polls || [];
    show_poll = open.length > 0;
    poll = {
      open_polls: open,
      active_poll: pollPublic.active_poll || null,
      current_cue: pollPublic.current_cue || null,
      in_poll_cue: pollPublic.in_poll_cue === true,
    };
  } catch (err) {
    console.warn('[engagement] poll slice skipped:', err.message || err);
  }

  let default_tab = 'wait';
  if (show_poll && show_qa) {
    // Prefer poll when one is open on the live cue; otherwise Q&A.
    default_tab = poll?.active_poll || poll?.in_poll_cue ? 'poll' : 'qa';
  } else if (show_poll) default_tab = 'poll';
  else if (show_qa) default_tab = 'qa';

  return {
    title,
    event_id: eventId,
    public_token: session.public_token,
    show_qa,
    show_poll,
    default_tab,
    qa,
    poll,
  };
}

module.exports = {
  ensureEngagementSchema,
  getOrCreateEngagementSession,
  getEngagementSessionByToken,
  rotateEngagementSessionToken,
  resolveEngagementByAnyToken,
  getPublicEngagement,
};
