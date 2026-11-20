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

function parseScheduleItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Strip leading CUE prefixes so "CUE CUE 13" / "CUE13" → "13". */
function cueFieldValue(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^(cue[\s._-]*)+/i, '')
    .trim();
}

/** One "CUE" + body (e.g. "CUE 13"). */
function formatCueDisplay(raw) {
  const body = cueFieldValue(raw);
  return body ? `CUE ${body}` : '';
}

function cueLabel(item) {
  if (!item || typeof item !== 'object') return '';
  const custom = item.customFields || item.custom_fields || {};
  return formatCueDisplay(custom.cue || item.cue || '');
}

function isQaSubRow(item, items) {
  if (!item || typeof item !== 'object') return false;
  if (item.qaIsAutoQa === true || item.qa_is_auto_qa === true) return true;
  if (item.isIndented === true || item.is_indented === true) return true;
  if (String(item.timerId || item.timer_id || '').toUpperCase() === 'QA') return true;
  const id = Number(item.id);
  if (Number.isFinite(id) && Array.isArray(items)) {
    const linkedAsSub = items.some(
      (row) => Number(row?.qaLinkedSubId || row?.qa_linked_sub_id) === id
    );
    if (linkedAsSub) return true;
  }
  // Q&A plan cue numbers look like "13Q" / "CUE 13Q"
  const body = cueFieldValue(
    (item.customFields && (item.customFields.cue || item.customFields.CUE)) ||
      item.cue ||
      ''
  );
  if (/^\d+Q$/i.test(body)) return true;
  const segment = String(item.segmentName || item.segment_name || '')
    .trim()
    .toLowerCase();
  if (segment === 'q&a' || segment === 'qa') return true;
  return false;
}

/** Parent schedule rows with the Q&A checkbox only — never indented / *Q timer rows. */
function itemIsQaCue(item, items) {
  if (!item || typeof item !== 'object') return false;
  if (!(item.hasQA === true || item.has_qa === true)) return false;
  if (isQaSubRow(item, items)) return false;
  return true;
}

function findParentForQaSub(items, subId) {
  const id = Number(subId);
  if (!Number.isFinite(id)) return null;
  return (
    items.find((row) => Number(row?.qaLinkedSubId || row?.qa_linked_sub_id) === id) || null
  );
}

function summarizeCue(item, items) {
  if (!item) return null;
  const id = Number(item.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    cue: cueLabel(item) || null,
    segment_name: String(item.segmentName || item.segment_name || '').trim() || null,
    has_qa: itemIsQaCue(item, items),
    qa_display_mode: item.qaDisplayMode || item.qa_display_mode || null,
  };
}

async function ensureWebQaSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.event_web_qa_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL UNIQUE,
      public_token TEXT NOT NULL UNIQUE,
      title TEXT,
      is_open BOOLEAN NOT NULL DEFAULT FALSE,
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

async function loadScheduleItems(db, eventId) {
  const result = await db.query(
    `SELECT schedule_items FROM public.run_of_show_data WHERE event_id = $1 LIMIT 1`,
    [eventId]
  );
  return parseScheduleItems(result.rows[0]?.schedule_items);
}

async function getActiveCueContext(db, eventId) {
  const items = await loadScheduleItems(db, eventId);
  const byId = new Map();
  for (const item of items) {
    const id = Number(item?.id);
    if (Number.isFinite(id)) byId.set(id, item);
  }

  let timer = null;
  try {
    const timerRes = await db.query(
      `SELECT item_id, last_loaded_cue_id, cue_is, is_active, is_running, timer_state
       FROM public.active_timers
       WHERE event_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [eventId]
    );
    timer = timerRes.rows[0] || null;
  } catch (err) {
    if (err && err.code !== '42P01') throw err;
  }

  const qaCues = items
    .filter((item) => itemIsQaCue(item, items))
    .map((item) => summarizeCue(item, items))
    .filter(Boolean);

  if (!timer) {
    return {
      current_cue: null,
      in_qa_cue: false,
      qa_cues: qaCues,
      timer: null,
    };
  }

  const active =
    timer.is_active !== false && String(timer.timer_state || '').toLowerCase() !== 'stopped';
  const rawId = active
    ? timer.item_id
    : timer.last_loaded_cue_id != null
      ? timer.last_loaded_cue_id
      : timer.item_id;
  const itemId = Number(rawId);
  const item = Number.isFinite(itemId) ? byId.get(itemId) || null : null;

  // If active row is an indented Q&A timer, resolve to its parent for label + open state.
  let displayItem = item;
  if (item && (item.qaIsAutoQa || item.qa_is_auto_qa)) {
    const parent = findParentForQaSub(items, itemId);
    if (parent) displayItem = parent;
  }

  const summary = summarizeCue(displayItem, items) || {
    id: Number.isFinite(itemId) ? itemId : null,
    cue: formatCueDisplay(timer.cue_is) || null,
    segment_name: null,
    has_qa: false,
    qa_display_mode: null,
  };
  if (summary && !summary.cue && timer.cue_is) {
    summary.cue = formatCueDisplay(timer.cue_is) || null;
  }

  // Open only when the parent row has Q&A checked (sub row maps to that parent).
  const inQaCue = !!(displayItem && itemIsQaCue(displayItem, items));

  return {
    current_cue: summary,
    in_qa_cue: inQaCue,
    qa_cues: qaCues,
    timer: {
      item_id: Number.isFinite(itemId) ? itemId : null,
      is_running: timer.is_running === true,
      is_active: active,
      cue_is: timer.cue_is || null,
    },
  };
}

async function syncSessionOpenFromCue(db, eventId, title) {
  const session = await getOrCreateSession(db, eventId, title);
  const context = await getActiveCueContext(db, eventId);
  const shouldOpen = context.in_qa_cue === true;
  if (session.is_open === shouldOpen) {
    return { session, context };
  }
  const updated = await updateSession(db, eventId, { is_open: shouldOpen });
  return { session: updated || session, context };
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
    `INSERT INTO public.event_web_qa_sessions (event_id, public_token, title, is_open)
     VALUES ($1, $2, $3, FALSE)
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

async function buildOverview(db, eventId, title) {
  const { session, context } = await syncSessionOpenFromCue(db, eventId, title);
  const questions = await listQuestions(db, eventId, 'all');
  const counts = { pending: 0, approved: 0, answered: 0, rejected: 0, archived: 0, all: questions.length };
  const byCue = new Map();
  for (const q of questions) {
    if (q.status in counts) counts[q.status] += 1;
    const cueId = q.cue_item_id != null ? Number(q.cue_item_id) : null;
    if (cueId != null && Number.isFinite(cueId)) {
      byCue.set(cueId, (byCue.get(cueId) || 0) + 1);
    }
  }
  const qaCues = (context.qa_cues || []).map((cue) => ({
    ...cue,
    question_count: byCue.get(cue.id) || 0,
  }));
  return {
    session,
    current_cue: context.current_cue,
    in_qa_cue: context.in_qa_cue,
    open_reason: context.in_qa_cue ? 'in_qa_cue' : 'out_of_qa_cue',
    qa_cues: qaCues,
    timer: context.timer,
    counts,
    question_total: questions.length,
  };
}

async function submitQuestion(db, session, { body, author_name, cue_item_id }) {
  const text = String(body || '').trim();
  if (!text) {
    const err = new Error('Question text is required');
    err.status = 400;
    throw err;
  }

  // Keep open/closed aligned with the loaded Q&A cue before accepting.
  const synced = await syncSessionOpenFromCue(db, session.event_id, session.title);
  const liveSession = synced.session || session;
  if (!liveSession.is_open) {
    const err = new Error('Q&A is closed for submissions');
    err.status = 403;
    throw err;
  }

  const name = String(author_name || '').trim().slice(0, 80) || null;
  let cueId =
    cue_item_id != null && Number.isFinite(Number(cue_item_id)) ? Number(cue_item_id) : null;
  if (cueId == null && synced.context?.current_cue?.id != null) {
    cueId = Number(synced.context.current_cue.id);
  }

  const result = await db.query(
    `INSERT INTO public.event_web_qa_questions
       (event_id, session_id, cue_item_id, author_name, body, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING id, event_id, session_id, cue_item_id, author_name, body, status,
               sort_order, created_at, updated_at, moderated_at, moderated_by`,
    [liveSession.event_id, liveSession.id, cueId, name, text.slice(0, 2000)]
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
  getActiveCueContext,
  syncSessionOpenFromCue,
  buildOverview,
  isMissingRelation,
  newPublicToken,
  normalizeStatus,
  itemIsQaCue,
  formatCueDisplay,
  cueFieldValue,
};
