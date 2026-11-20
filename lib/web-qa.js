/**
 * Live web Q&A sessions + moderated questions (Neon).
 */
const crypto = require('crypto');

const QA_STATUSES = new Set(['pending', 'approved', 'answered', 'rejected', 'archived']);

function newPublicToken() {
  return crypto.randomBytes(12).toString('base64url');
}

function normalizeStatus(value, fallback = 'pending') {
  const key = String(value || '').trim().toLowerCase();
  return QA_STATUSES.has(key) ? key : fallback;
}

function isMissingRelation(err) {
  return err && (err.code === '42P01' || /event_web_qa_/i.test(String(err.message || '')));
}

async function ensureWebQaSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.event_web_qa_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL UNIQUE,
      public_token TEXT NOT NULL UNIQUE,
      title TEXT,
      is_open BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_event_web_qa_sessions_token
      ON public.event_web_qa_sessions (public_token)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.event_web_qa_questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL,
      session_id UUID NOT NULL REFERENCES public.event_web_qa_sessions(id) ON DELETE CASCADE,
      cue_item_id BIGINT,
      author_name TEXT,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'answered', 'rejected', 'archived')),
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      moderated_at TIMESTAMPTZ,
      moderated_by TEXT
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_event_web_qa_questions_event_status
      ON public.event_web_qa_questions (event_id, status, created_at ASC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_event_web_qa_questions_session
      ON public.event_web_qa_questions (session_id, created_at ASC)
  `);
}

async function getOrCreateSession(db, eventId, title) {
  const existing = await db.query(
    `SELECT id, event_id, public_token, title, is_open, created_at, updated_at
     FROM public.event_web_qa_sessions
     WHERE event_id = $1
     LIMIT 1`,
    [eventId]
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    const nextTitle = title != null ? String(title).trim() : '';
    if (nextTitle && !row.title) {
      const updated = await db.query(
        `UPDATE public.event_web_qa_sessions
         SET title = $2, updated_at = NOW()
         WHERE event_id = $1
         RETURNING id, event_id, public_token, title, is_open, created_at, updated_at`,
        [eventId, nextTitle]
      );
      return updated.rows[0] || row;
    }
    return row;
  }

  const token = newPublicToken();
  const inserted = await db.query(
    `INSERT INTO public.event_web_qa_sessions (event_id, public_token, title)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_id) DO UPDATE SET updated_at = NOW()
     RETURNING id, event_id, public_token, title, is_open, created_at, updated_at`,
    [eventId, token, title || null]
  );
  return inserted.rows[0];
}

async function getSessionByToken(db, token) {
  const result = await db.query(
    `SELECT id, event_id, public_token, title, is_open, created_at, updated_at
     FROM public.event_web_qa_sessions
     WHERE public_token = $1
     LIMIT 1`,
    [token]
  );
  return result.rows[0] || null;
}

async function rotateSessionToken(db, eventId) {
  const token = newPublicToken();
  const result = await db.query(
    `UPDATE public.event_web_qa_sessions
     SET public_token = $2, updated_at = NOW()
     WHERE event_id = $1
     RETURNING id, event_id, public_token, title, is_open, created_at, updated_at`,
    [eventId, token]
  );
  return result.rows[0] || null;
}

async function updateSession(db, eventId, patch) {
  const updates = [];
  const params = [];
  if (typeof patch.is_open === 'boolean') {
    params.push(patch.is_open);
    updates.push(`is_open = $${params.length}`);
  }
  if (patch.title != null) {
    params.push(String(patch.title).trim() || null);
    updates.push(`title = $${params.length}`);
  }
  if (updates.length === 0) return getOrCreateSession(db, eventId);
  updates.push('updated_at = NOW()');
  params.push(eventId);
  const result = await db.query(
    `UPDATE public.event_web_qa_sessions
     SET ${updates.join(', ')}
     WHERE event_id = $${params.length}
     RETURNING id, event_id, public_token, title, is_open, created_at, updated_at`,
    params
  );
  return result.rows[0] || null;
}

async function listQuestions(db, eventId, status) {
  const params = [eventId];
  let statusClause = '';
  if (status && status !== 'all') {
    params.push(normalizeStatus(status));
    statusClause = `AND status = $${params.length}`;
  }
  const result = await db.query(
    `SELECT id, event_id, session_id, cue_item_id, author_name, body, status,
            sort_order, created_at, updated_at, moderated_at, moderated_by
     FROM public.event_web_qa_questions
     WHERE event_id = $1 ${statusClause}
     ORDER BY
       CASE status
         WHEN 'pending' THEN 0
         WHEN 'approved' THEN 1
         WHEN 'answered' THEN 2
         WHEN 'rejected' THEN 3
         ELSE 4
       END,
       created_at ASC`,
    params
  );
  return result.rows;
}

async function submitQuestion(db, session, { body, author_name, cue_item_id }) {
  const text = String(body || '').trim();
  if (!text) {
    const err = new Error('Question text is required');
    err.status = 400;
    throw err;
  }
  if (!session.is_open) {
    const err = new Error('Q&A is closed for submissions');
    err.status = 403;
    throw err;
  }
  const name = String(author_name || '').trim().slice(0, 80) || null;
  const cueId =
    cue_item_id != null && Number.isFinite(Number(cue_item_id)) ? Number(cue_item_id) : null;
  const result = await db.query(
    `INSERT INTO public.event_web_qa_questions
       (event_id, session_id, cue_item_id, author_name, body, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING id, event_id, session_id, cue_item_id, author_name, body, status,
               sort_order, created_at, updated_at, moderated_at, moderated_by`,
    [session.event_id, session.id, cueId, name, text.slice(0, 2000)]
  );
  return result.rows[0];
}

async function updateQuestion(db, id, { status, moderated_by }) {
  const nextStatus = normalizeStatus(status, null);
  if (!nextStatus) {
    const err = new Error('Valid status is required');
    err.status = 400;
    throw err;
  }
  const result = await db.query(
    `UPDATE public.event_web_qa_questions
     SET status = $2,
         moderated_at = NOW(),
         moderated_by = $3,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, event_id, session_id, cue_item_id, author_name, body, status,
               sort_order, created_at, updated_at, moderated_at, moderated_by`,
    [id, nextStatus, moderated_by || null]
  );
  return result.rows[0] || null;
}

async function deleteQuestion(db, id) {
  const result = await db.query(
    `DELETE FROM public.event_web_qa_questions WHERE id = $1 RETURNING id, event_id`,
    [id]
  );
  return result.rows[0] || null;
}

module.exports = {
  QA_STATUSES,
  ensureWebQaSchema,
  getOrCreateSession,
  getSessionByToken,
  rotateSessionToken,
  updateSession,
  listQuestions,
  submitQuestion,
  updateQuestion,
  deleteQuestion,
  isMissingRelation,
  newPublicToken,
  normalizeStatus,
};
