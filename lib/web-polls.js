/**
 * Live web polls — soft Neon inbox → drain → counters + results_snapshot.
 * Inbox backend: neon (default) | redis (when configured + Admin toggle).
 */

const crypto = require('crypto');

const POLL_TYPES = new Set(['single', 'multi', 'yesno', 'rating', 'ranked']);
const POLL_STATUSES = new Set(['draft', 'open', 'closed', 'finalizing', 'final']);
const INBOX_BACKENDS = new Set(['neon', 'redis']);
const DEFAULT_COLORS = [
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#fbbf24',
  '#fb923c',
  '#2dd4bf',
  '#94a3b8',
];

function newPublicToken() {
  return crypto.randomBytes(12).toString('base64url');
}

function isMissingRelation(err) {
  return err?.code === '42P01' || /does not exist/i.test(String(err?.message || ''));
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizePollType(value) {
  const t = String(value || '').trim().toLowerCase();
  return POLL_TYPES.has(t) ? t : null;
}

function normalizeVoterKey(value) {
  return String(value || '')
    .trim()
    .slice(0, 200);
}

function clientIp(req) {
  const xf = req?.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).trim();
  return String(req?.ip || req?.socket?.remoteAddress || '').trim();
}

async function ensureWebPollsSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.event_web_polls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL,
      public_token TEXT NOT NULL UNIQUE,
      question TEXT NOT NULL,
      poll_type TEXT NOT NULL
        CHECK (poll_type IN ('single', 'multi', 'yesno', 'rating', 'ranked')),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'open', 'closed', 'finalizing', 'final')),
      cue_item_id BIGINT,
      received_count INT NOT NULL DEFAULT 0,
      counted_count INT NOT NULL DEFAULT 0,
      results_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      opened_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      finalized_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_event_web_polls_event
      ON public.event_web_polls (event_id, created_at DESC)
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_event_web_polls_token
      ON public.event_web_polls (public_token)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.event_web_poll_options (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      poll_id UUID NOT NULL REFERENCES public.event_web_polls(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      color TEXT,
      sort_order INT NOT NULL DEFAULT 0,
      vote_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_event_web_poll_options_poll
      ON public.event_web_poll_options (poll_id, sort_order ASC)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.event_web_poll_ballots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      poll_id UUID NOT NULL REFERENCES public.event_web_polls(id) ON DELETE CASCADE,
      voter_key TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (poll_id, voter_key)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_event_web_poll_ballots_poll
      ON public.event_web_poll_ballots (poll_id, created_at ASC)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.event_web_poll_votes_inbox (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      poll_id UUID NOT NULL REFERENCES public.event_web_polls(id) ON DELETE CASCADE,
      voter_key TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_event_web_poll_inbox_pending
      ON public.event_web_poll_votes_inbox (poll_id, created_at ASC)
      WHERE processed_at IS NULL
  `);
  try {
    await db.query(`
      ALTER TABLE public.app_settings
        ADD COLUMN IF NOT EXISTS poll_inbox_backend TEXT NOT NULL DEFAULT 'neon'
    `);
  } catch (err) {
    console.warn('[web-polls] app_settings.poll_inbox_backend sync skipped:', err.message || err);
  }
}

function redisConfigured() {
  return Boolean(String(process.env.REDIS_URL || process.env.REDISHOST || '').trim());
}

async function getPollInboxBackend(db) {
  const env = String(process.env.POLL_INBOX_BACKEND || '').trim().toLowerCase();
  if (INBOX_BACKENDS.has(env)) {
    if (env === 'redis' && !redisConfigured()) return 'neon';
    return env;
  }
  try {
    const r = await db.query(
      `SELECT poll_inbox_backend FROM public.app_settings WHERE id = 1 LIMIT 1`
    );
    const v = String(r.rows[0]?.poll_inbox_backend || 'neon').trim().toLowerCase();
    if (v === 'redis' && !redisConfigured()) return 'neon';
    return INBOX_BACKENDS.has(v) ? v : 'neon';
  } catch {
    return 'neon';
  }
}

async function setPollInboxBackend(db, backend) {
  const v = String(backend || '').trim().toLowerCase();
  if (!INBOX_BACKENDS.has(v)) throw httpError(400, 'poll_inbox_backend must be neon or redis');
  if (v === 'redis' && !redisConfigured()) {
    throw httpError(400, 'Redis is not configured (set REDIS_URL / Railway Redis first)');
  }
  await db.query(`
    ALTER TABLE public.app_settings
      ADD COLUMN IF NOT EXISTS poll_inbox_backend TEXT NOT NULL DEFAULT 'neon'
  `);
  await db.query(
    `INSERT INTO public.app_settings (id, poll_inbox_backend, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE
     SET poll_inbox_backend = EXCLUDED.poll_inbox_backend, updated_at = NOW()`,
    [v]
  );
  return { poll_inbox_backend: v, redis_configured: redisConfigured() };
}

function normalizeOptionsInput(pollType, options) {
  if (pollType === 'rating') {
    return [1, 2, 3, 4, 5].map((n, i) => ({
      label: String(n),
      color: DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      sort_order: i,
    }));
  }
  if (pollType === 'yesno') {
    const base = Array.isArray(options) && options.length >= 2 ? options : [
      { label: 'Yes', color: '#34d399' },
      { label: 'No', color: '#f87171' },
      { label: 'Skip', color: '#64748b' },
    ];
    return base.slice(0, 3).map((o, i) => ({
      label: String(o.label || o || '').trim() || `Option ${i + 1}`,
      color: o.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      sort_order: i,
    }));
  }
  const list = Array.isArray(options) ? options : [];
  if (list.length < 2) throw httpError(400, 'At least 2 options are required');
  if (list.length > 8) throw httpError(400, 'At most 8 options are allowed');
  return list.map((o, i) => ({
    label: String(o.label || o || '').trim() || `Option ${i + 1}`,
    color: o.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
    sort_order: typeof o.sort_order === 'number' ? o.sort_order : i,
  }));
}

function buildSnapshot(poll, options) {
  return {
    poll_id: poll.id,
    status: poll.status,
    received: poll.received_count || 0,
    counted: poll.counted_count || 0,
    options: (options || []).map((o) => ({
      id: o.id,
      label: o.label,
      color: o.color,
      votes: o.vote_count || 0,
      sort_order: o.sort_order,
    })),
    updated_at: new Date().toISOString(),
  };
}

async function listOptions(db, pollId) {
  const r = await db.query(
    `SELECT id, poll_id, label, color, sort_order, vote_count, created_at
     FROM public.event_web_poll_options
     WHERE poll_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [pollId]
  );
  return r.rows;
}

async function refreshSnapshot(db, pollId) {
  const pollR = await db.query(`SELECT * FROM public.event_web_polls WHERE id = $1`, [pollId]);
  const poll = pollR.rows[0];
  if (!poll) return null;
  const options = await listOptions(db, pollId);
  const snapshot = buildSnapshot(poll, options);
  await db.query(
    `UPDATE public.event_web_polls
     SET results_snapshot = $2::jsonb, updated_at = NOW()
     WHERE id = $1`,
    [pollId, JSON.stringify(snapshot)]
  );
  return snapshot;
}

async function createPoll(db, { eventId, question, pollType, options, cueItemId }) {
  const type = normalizePollType(pollType);
  if (!type) throw httpError(400, 'Invalid poll_type');
  const q = String(question || '').trim();
  if (!q) throw httpError(400, 'question is required');
  const event_id = String(eventId || '').trim();
  if (!event_id) throw httpError(400, 'eventId is required');

  const normalized = normalizeOptionsInput(type, options);
  const token = newPublicToken();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const pollR = await client.query(
      `INSERT INTO public.event_web_polls
         (event_id, public_token, question, poll_type, status, cue_item_id)
       VALUES ($1, $2, $3, $4, 'draft', $5)
       RETURNING *`,
      [event_id, token, q, type, cueItemId != null && cueItemId !== '' ? Number(cueItemId) : null]
    );
    const poll = pollR.rows[0];
    for (const opt of normalized) {
      await client.query(
        `INSERT INTO public.event_web_poll_options (poll_id, label, color, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [poll.id, opt.label, opt.color, opt.sort_order]
      );
    }
    await client.query('COMMIT');
    const opts = await listOptions(db, poll.id);
    const snapshot = await refreshSnapshot(db, poll.id);
    return { ...poll, options: opts, results_snapshot: snapshot };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function listPollsForEvent(db, eventId) {
  const r = await db.query(
    `SELECT * FROM public.event_web_polls
     WHERE event_id = $1
     ORDER BY created_at DESC`,
    [String(eventId || '').trim()]
  );
  const rows = [];
  for (const poll of r.rows) {
    const options = await listOptions(db, poll.id);
    rows.push({ ...poll, options });
  }
  return rows;
}

async function getPollById(db, pollId) {
  const r = await db.query(`SELECT * FROM public.event_web_polls WHERE id = $1`, [pollId]);
  const poll = r.rows[0];
  if (!poll) return null;
  const options = await listOptions(db, poll.id);
  return { ...poll, options };
}

async function getPollByToken(db, token) {
  const r = await db.query(
    `SELECT * FROM public.event_web_polls WHERE public_token = $1 LIMIT 1`,
    [String(token || '').trim()]
  );
  const poll = r.rows[0];
  if (!poll) return null;
  const options = await listOptions(db, poll.id);
  return { ...poll, options };
}

async function setPollStatus(db, pollId, status) {
  const next = String(status || '').trim().toLowerCase();
  if (!POLL_STATUSES.has(next)) throw httpError(400, 'Invalid status');
  let sql = `UPDATE public.event_web_polls SET status = $2, updated_at = NOW()`;
  if (next === 'open') sql += `, opened_at = COALESCE(opened_at, NOW()), closed_at = NULL, finalized_at = NULL`;
  if (next === 'closed') sql += `, closed_at = NOW()`;
  if (next === 'final') sql += `, finalized_at = NOW(), status = 'final'`;
  if (next === 'finalizing') sql += ``;
  sql += ` WHERE id = $1 RETURNING *`;
  const r = await db.query(sql, [pollId, next === 'final' ? 'final' : next]);
  if (!r.rows[0]) throw httpError(404, 'Poll not found');
  await refreshSnapshot(db, pollId);
  return getPollById(db, pollId);
}

function validatePayload(poll, options, payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const ids = new Set(options.map((o) => String(o.id)));
  if (poll.poll_type === 'single' || poll.poll_type === 'yesno') {
    const optionId = String(body.optionId || body.option_id || '').trim();
    if (!ids.has(optionId)) throw httpError(400, 'Valid optionId is required');
    return { optionId };
  }
  if (poll.poll_type === 'multi') {
    const raw = body.optionIds || body.option_ids || [];
    if (!Array.isArray(raw) || raw.length === 0) throw httpError(400, 'optionIds required');
    const optionIds = [...new Set(raw.map((x) => String(x).trim()).filter((id) => ids.has(id)))];
    if (!optionIds.length) throw httpError(400, 'At least one valid optionId required');
    return { optionIds };
  }
  if (poll.poll_type === 'rating') {
    const score = Number(body.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw httpError(400, 'score must be an integer 1–5');
    }
    const opt = options.find((o) => String(o.label) === String(score));
    if (!opt) throw httpError(400, 'Rating options not configured');
    return { score, optionId: opt.id };
  }
  if (poll.poll_type === 'ranked') {
    const order = body.order || body.optionIds || [];
    if (!Array.isArray(order) || order.length !== options.length) {
      throw httpError(400, 'order must include every option once');
    }
    const cleaned = order.map((x) => String(x).trim());
    if (new Set(cleaned).size !== cleaned.length || cleaned.some((id) => !ids.has(id))) {
      throw httpError(400, 'order must be a valid permutation of options');
    }
    return { order: cleaned };
  }
  throw httpError(400, 'Unsupported poll type');
}

async function enqueueNeon(db, pollId, voterKey, payload) {
  await db.query(
    `INSERT INTO public.event_web_poll_votes_inbox (poll_id, voter_key, payload)
     VALUES ($1, $2, $3::jsonb)`,
    [pollId, voterKey, JSON.stringify(payload)]
  );
  await db.query(
    `UPDATE public.event_web_polls
     SET received_count = received_count + 1, updated_at = NOW()
     WHERE id = $1`,
    [pollId]
  );
}

async function acceptVote(db, poll, { voterKey, payload }) {
  if (poll.status !== 'open') throw httpError(403, 'Poll is not open');
  const key = normalizeVoterKey(voterKey);
  if (!key) throw httpError(400, 'voter_key is required');

  const existing = await db.query(
    `SELECT 1 FROM public.event_web_poll_ballots WHERE poll_id = $1 AND voter_key = $2 LIMIT 1`,
    [poll.id, key]
  );
  if (existing.rows.length) throw httpError(409, 'Already voted');

  const pending = await db.query(
    `SELECT 1 FROM public.event_web_poll_votes_inbox
     WHERE poll_id = $1 AND voter_key = $2 AND processed_at IS NULL
     LIMIT 1`,
    [poll.id, key]
  );
  if (pending.rows.length) throw httpError(409, 'Vote already received');

  const options = poll.options || (await listOptions(db, poll.id));
  const normalized = validatePayload(poll, options, payload);

  const backend = await getPollInboxBackend(db);
  if (backend === 'redis') {
    // Full B path — requires Railway Redis wiring; soft path until then.
    throw httpError(
      503,
      'Redis inbox selected but not wired yet — set poll inbox backend to neon (soft v1)'
    );
  }

  await enqueueNeon(db, poll.id, key, normalized);
  // Opportunistic drain so demos feel live without a separate worker process.
  setImmediate(() => {
    drainInbox(db, { limit: 50 }).catch((err) => {
      console.warn('[web-polls] drain after accept failed:', err.message || err);
    });
  });

  return {
    ok: true,
    accepted: true,
    poll_id: poll.id,
    inbox_backend: 'neon',
    status: 'queued',
  };
}

function optionIdsFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (payload.optionId) return [String(payload.optionId)];
  if (Array.isArray(payload.optionIds)) return payload.optionIds.map(String);
  // Ranked: count first-place only for v1 totals (simple leaderboard).
  if (Array.isArray(payload.order) && payload.order.length) return [String(payload.order[0])];
  return [];
}

async function commitInboxRow(client, row) {
  const ballot = await client.query(
    `INSERT INTO public.event_web_poll_ballots (poll_id, voter_key, payload)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (poll_id, voter_key) DO NOTHING
     RETURNING id`,
    [row.poll_id, row.voter_key, JSON.stringify(row.payload || {})]
  );

  await client.query(
    `UPDATE public.event_web_poll_votes_inbox
     SET processed_at = NOW()
     WHERE id = $1`,
    [row.id]
  );

  if (!ballot.rows[0]) {
    // Duplicate voter — counted as processed, no counter bump.
    return { committed: false };
  }

  const optionIds = optionIdsFromPayload(row.payload);
  for (const optionId of optionIds) {
    await client.query(
      `UPDATE public.event_web_poll_options
       SET vote_count = vote_count + 1
       WHERE id = $1 AND poll_id = $2`,
      [optionId, row.poll_id]
    );
  }

  await client.query(
    `UPDATE public.event_web_polls
     SET counted_count = counted_count + 1, updated_at = NOW()
     WHERE id = $1`,
    [row.poll_id]
  );
  return { committed: true, pollId: row.poll_id };
}

async function drainInbox(db, { limit = 100, pollId = null } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const params = pollId ? [pollId, lim] : [lim];
  const sql = pollId
    ? `SELECT id, poll_id, voter_key, payload
       FROM public.event_web_poll_votes_inbox
       WHERE processed_at IS NULL AND poll_id = $1
       ORDER BY created_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`
    : `SELECT id, poll_id, voter_key, payload
       FROM public.event_web_poll_votes_inbox
       WHERE processed_at IS NULL
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`;

  const client = await db.connect();
  const touched = new Set();
  let processed = 0;
  let committed = 0;
  try {
    await client.query('BEGIN');
    const pending = await client.query(sql, params);
    for (const row of pending.rows) {
      const result = await commitInboxRow(client, row);
      processed += 1;
      if (result.committed) {
        committed += 1;
        touched.add(result.pollId);
      } else if (row.poll_id) {
        touched.add(row.poll_id);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }

  for (const id of touched) {
    await refreshSnapshot(db, id);
  }

  return { processed, committed, polls_updated: [...touched] };
}

async function getRollup(db, pollId) {
  const poll = await getPollById(db, pollId);
  if (!poll) return null;
  const pendingR = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM public.event_web_poll_votes_inbox
     WHERE poll_id = $1 AND processed_at IS NULL`,
    [pollId]
  );
  return {
    poll,
    received: poll.received_count,
    counted: poll.counted_count,
    pending_inbox: pendingR.rows[0]?.n || 0,
    results_snapshot: poll.results_snapshot,
    inbox_backend: await getPollInboxBackend(db),
  };
}

module.exports = {
  POLL_TYPES: [...POLL_TYPES],
  ensureWebPollsSchema,
  isMissingRelation,
  clientIp,
  getPollInboxBackend,
  setPollInboxBackend,
  redisConfigured,
  createPoll,
  listPollsForEvent,
  getPollById,
  getPollByToken,
  setPollStatus,
  acceptVote,
  drainInbox,
  getRollup,
  refreshSnapshot,
};
