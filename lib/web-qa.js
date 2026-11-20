/**
 * Live web Q&A sessions + moderated questions (Neon).
 */
const crypto = require('crypto');

const QA_STATUSES = new Set(['pending', 'approved', 'answered', 'rejected', 'archived']);
/** Visible in Active/Select/Reader; further submissions still store as overflow. */
const VISIBLE_SOFT_LIMIT = 300;
/** One realistic spoken question — keeps Reader / vMix / mod cards scannable. */
const MAX_BODY_CHARS = 400;

function normalizeEmail(value) {
  const email = String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 160);
  if (!email) return null;
  // Practical check — enough to block empty/garbage, not a full RFC validator.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

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
  try {
    await db.query(`
      ALTER TABLE public.event_web_qa_questions
        ADD COLUMN IF NOT EXISTS is_queued BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_event_web_qa_questions_event_queue
        ON public.event_web_qa_questions (event_id, is_queued, sort_order ASC)
    `);
  } catch (err) {
    console.warn('[web-qa] queue column sync skipped:', err.message || err);
  }
  try {
    await db.query(`
      ALTER TABLE public.event_web_qa_questions
        ADD COLUMN IF NOT EXISTS author_email TEXT
    `);
    await db.query(`
      ALTER TABLE public.event_web_qa_questions
        ADD COLUMN IF NOT EXISTS is_overflow BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_event_web_qa_questions_event_overflow
        ON public.event_web_qa_questions (event_id, is_overflow, created_at ASC)
    `);
  } catch (err) {
    console.warn('[web-qa] overflow column sync skipped:', err.message || err);
  }
  try {
    await db.query(`
      ALTER TABLE public.event_web_qa_questions
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_event_web_qa_questions_one_active
        ON public.event_web_qa_questions (event_id)
        WHERE is_active = TRUE
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_event_web_qa_questions_event_active
        ON public.event_web_qa_questions (event_id, is_active)
        WHERE is_active = TRUE
    `);
  } catch (err) {
    console.warn('[web-qa] active column sync skipped:', err.message || err);
  }
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

const QUESTION_SELECT = `id, event_id, session_id, cue_item_id, author_name, author_email, body, status,
            is_queued, is_active, is_overflow, sort_order, created_at, updated_at, moderated_at, moderated_by`;

async function countVisibleQuestions(db, eventId) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM public.event_web_qa_questions
     WHERE event_id = $1 AND COALESCE(is_overflow, FALSE) = FALSE`,
    [eventId]
  );
  return Number(result.rows[0]?.n) || 0;
}

async function countOverflowQuestions(db, eventId) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM public.event_web_qa_questions
     WHERE event_id = $1 AND is_overflow = TRUE`,
    [eventId]
  );
  return Number(result.rows[0]?.n) || 0;
}

async function getSoftLimitState(db, eventId) {
  const visible_count = await countVisibleQuestions(db, eventId);
  const overflow_count = await countOverflowQuestions(db, eventId);
  return {
    soft_limit: VISIBLE_SOFT_LIMIT,
    visible_count,
    overflow_count,
    question_total: visible_count + overflow_count,
    at_soft_limit: visible_count >= VISIBLE_SOFT_LIMIT,
  };
}

/**
 * @param {{ includeOverflow?: boolean }} [opts]
 * Default excludes overflow (live mod UI). Pass includeOverflow for report export.
 */
async function listQuestions(db, eventId, status, opts = {}) {
  const includeOverflow = opts.includeOverflow === true;
  const params = [eventId];
  let statusClause = '';
  if (status && status !== 'all') {
    params.push(normalizeStatus(status));
    statusClause = `AND status = $${params.length}`;
  }
  const overflowClause = includeOverflow ? '' : 'AND COALESCE(is_overflow, FALSE) = FALSE';
  const result = await db.query(
    `SELECT ${QUESTION_SELECT}
     FROM public.event_web_qa_questions
     WHERE event_id = $1 ${statusClause} ${overflowClause}
     ORDER BY
       CASE WHEN is_queued THEN 0 ELSE 1 END,
       sort_order ASC NULLS LAST,
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

async function nextQueueOrder(db, eventId) {
  const result = await db.query(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next
     FROM public.event_web_qa_questions
     WHERE event_id = $1 AND is_queued = TRUE`,
    [eventId]
  );
  return Number(result.rows[0]?.next) || 1;
}

/** Next sort_order among approved (Reader order), excluding active. */
async function nextApprovedOrder(db, eventId) {
  const result = await db.query(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next
     FROM public.event_web_qa_questions
     WHERE event_id = $1
       AND status = 'approved'
       AND COALESCE(is_active, FALSE) = FALSE`,
    [eventId]
  );
  return Number(result.rows[0]?.next) || 1;
}

async function getActiveQuestion(db, eventId) {
  const result = await db.query(
    `SELECT ${QUESTION_SELECT}
     FROM public.event_web_qa_questions
     WHERE event_id = $1 AND is_active = TRUE
     LIMIT 1`,
    [eventId]
  );
  return result.rows[0] || null;
}

async function buildOverview(db, eventId, title) {
  const { session, context } = await syncSessionOpenFromCue(db, eventId, title);
  const questions = await listQuestions(db, eventId, 'all', { includeOverflow: false });
  const soft = await getSoftLimitState(db, eventId);
  const active_question = await getActiveQuestion(db, eventId);
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
    question_total: soft.question_total,
    soft_limit: soft.soft_limit,
    visible_count: soft.visible_count,
    overflow_count: soft.overflow_count,
    at_soft_limit: soft.at_soft_limit,
    active_question,
  };
}

async function submitQuestion(db, session, { body, author_name, author_email, cue_item_id }) {
  const text = String(body || '').trim();
  if (!text) {
    const err = new Error('Question text is required');
    err.status = 400;
    throw err;
  }
  if (text.length > MAX_BODY_CHARS) {
    const err = new Error(`Please keep questions to ${MAX_BODY_CHARS} characters or fewer`);
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

  const visibleCount = await countVisibleQuestions(db, liveSession.event_id);
  const isOverflow = visibleCount >= VISIBLE_SOFT_LIMIT;
  const email = normalizeEmail(author_email);
  if (isOverflow && !email) {
    const err = new Error(
      'Live Q&A is at capacity. Please leave an email so we can follow up if we can answer later.'
    );
    err.status = 400;
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
       (event_id, session_id, cue_item_id, author_name, author_email, body, status, is_overflow)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
     RETURNING ${QUESTION_SELECT}`,
    [
      liveSession.event_id,
      liveSession.id,
      cueId,
      name,
      email,
      text.slice(0, MAX_BODY_CHARS),
      isOverflow,
    ]
  );
  return result.rows[0];
}

async function getQuestionById(db, id) {
  const result = await db.query(
    `SELECT ${QUESTION_SELECT} FROM public.event_web_qa_questions WHERE id = $1 LIMIT 1`,
    [id]
  );
  return result.rows[0] || null;
}

async function updateQuestion(db, id, patch = {}) {
  const existing = await getQuestionById(db, id);
  if (!existing) return null;

  const updates = [];
  const params = [];
  let nextStatus = existing.status;
  const markDone =
    patch.mark_done === true ||
    patch.complete === true ||
    (patch.status != null &&
      normalizeStatus(patch.status, null) === 'answered' &&
      (existing.is_active === true || patch.is_active === false));

  if (markDone) {
    // Done / answered — clear ACTIVE + queue so the next queued can go on-air.
    nextStatus = 'answered';
    params.push(nextStatus);
    updates.push(`status = $${params.length}`);
    params.push(false);
    updates.push(`is_active = $${params.length}`);
    params.push(false);
    updates.push(`is_queued = $${params.length}`);
    params.push(0);
    updates.push(`sort_order = $${params.length}`);
  } else {
    if (patch.status != null) {
      nextStatus = normalizeStatus(patch.status, null);
      if (!nextStatus) {
        const err = new Error('Valid status is required');
        err.status = 400;
        throw err;
      }
      params.push(nextStatus);
      updates.push(`status = $${params.length}`);
      if (nextStatus === 'answered' || nextStatus === 'rejected' || nextStatus === 'archived') {
        params.push(false);
        updates.push(`is_active = $${params.length}`);
      }
      // Reader order: newly approved get the next slot unless already ordered.
      if (
        nextStatus === 'approved' &&
        existing.status !== 'approved' &&
        !(Number(existing.sort_order) > 0)
      ) {
        const order = await nextApprovedOrder(db, existing.event_id);
        params.push(order);
        updates.push(`sort_order = $${params.length}`);
      }
    }

    if (typeof patch.is_active === 'boolean') {
      if (patch.is_active) {
        if (existing.is_overflow === true) {
          const err = new Error('Overflow questions cannot be made active');
          err.status = 400;
          throw err;
        }
        if (existing.status === 'rejected' || existing.status === 'archived') {
          const err = new Error('Rejected questions cannot be made active');
          err.status = 400;
          throw err;
        }
        const currentActive = await getActiveQuestion(db, existing.event_id);
        if (currentActive && currentActive.id !== existing.id) {
          const err = new Error(
            'Mark the current ACTIVE question Done before activating another'
          );
          err.status = 409;
          throw err;
        }
        // Activating implies approved + still in showcase pipeline.
        if (!existing.is_queued) {
          const order = await nextQueueOrder(db, existing.event_id);
          params.push(true);
          updates.push(`is_queued = $${params.length}`);
          params.push(order);
          updates.push(`sort_order = $${params.length}`);
        }
        if (nextStatus === 'pending' || nextStatus === 'rejected') {
          nextStatus = 'approved';
          params.push(nextStatus);
          updates.push(`status = $${params.length}`);
        }
        params.push(true);
        updates.push(`is_active = $${params.length}`);
      } else if (existing.is_active) {
        params.push(false);
        updates.push(`is_active = $${params.length}`);
      }
    }

    if (typeof patch.is_queued === 'boolean') {
      if (patch.is_queued && existing.is_overflow === true) {
        const err = new Error('Overflow questions are report-only and cannot be queued');
        err.status = 400;
        throw err;
      }
      if (!patch.is_queued && existing.is_active === true) {
        const err = new Error('Mark the ACTIVE question Done before removing it from the queue');
        err.status = 409;
        throw err;
      }
      params.push(patch.is_queued);
      updates.push(`is_queued = $${params.length}`);
      if (patch.is_queued) {
        const order =
          patch.queue_order != null && Number.isFinite(Number(patch.queue_order))
            ? Number(patch.queue_order)
            : await nextQueueOrder(db, existing.event_id);
        params.push(order);
        updates.push(`sort_order = $${params.length}`);
        if (nextStatus === 'pending' || nextStatus === 'rejected') {
          nextStatus = 'approved';
          params.push(nextStatus);
          updates.push(`status = $${params.length}`);
        }
      } else {
        params.push(0);
        updates.push(`sort_order = $${params.length}`);
      }
    } else if (patch.queue_order != null && Number.isFinite(Number(patch.queue_order))) {
      params.push(Number(patch.queue_order));
      updates.push(`sort_order = $${params.length}`);
    }
  }

  if (patch.moderated_by !== undefined || updates.length > 0) {
    params.push(patch.moderated_by || null);
    updates.push(`moderated_by = $${params.length}`);
    updates.push('moderated_at = NOW()');
  }

  if (updates.length === 0) return existing;

  updates.push('updated_at = NOW()');
  params.push(id);
  const result = await db.query(
    `UPDATE public.event_web_qa_questions
     SET ${updates.join(', ')}
     WHERE id = $${params.length}
     RETURNING ${QUESTION_SELECT}`,
    params
  );
  return result.rows[0] || null;
}

/**
 * Reorder questions.
 * scope 'queued' (default): showcase queue rows (forces is_queued).
 * scope 'approved': Reader order for approved (not active) questions.
 */
async function reorderQueuedQuestions(db, eventId, orderedIds, moderatedBy, opts = {}) {
  const ids = (Array.isArray(orderedIds) ? orderedIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const scope = String(opts.scope || 'queued').toLowerCase() === 'approved' ? 'approved' : 'queued';
  const client = db;
  for (let i = 0; i < ids.length; i++) {
    if (scope === 'approved') {
      await client.query(
        `UPDATE public.event_web_qa_questions
         SET sort_order = $3,
             moderated_at = NOW(),
             moderated_by = COALESCE($4, moderated_by),
             updated_at = NOW()
         WHERE id = $1
           AND event_id = $2
           AND status = 'approved'
           AND COALESCE(is_active, FALSE) = FALSE`,
        [ids[i], eventId, i + 1, moderatedBy || null]
      );
    } else {
      await client.query(
        `UPDATE public.event_web_qa_questions
         SET sort_order = $3,
             is_queued = TRUE,
             moderated_at = NOW(),
             moderated_by = COALESCE($4, moderated_by),
             updated_at = NOW()
         WHERE id = $1 AND event_id = $2 AND is_queued = TRUE`,
        [ids[i], eventId, i + 1, moderatedBy || null]
      );
    }
  }
  return listQuestions(db, eventId, 'all');
}

async function deleteQuestion(db, id) {
  const result = await db.query(
    `DELETE FROM public.event_web_qa_questions WHERE id = $1 RETURNING id, event_id`,
    [id]
  );
  return result.rows[0] || null;
}

function escapeCsvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

async function cueLookupMap(db, eventId) {
  const items = await loadScheduleItems(db, eventId);
  const cueById = new Map();
  for (const item of items) {
    const summary = summarizeCue(item, items);
    if (summary?.id != null) cueById.set(summary.id, summary);
  }
  return cueById;
}

function questionCsvRow(q, rowNum, cueById) {
  const cueId = q.cue_item_id != null ? Number(q.cue_item_id) : null;
  const meta = cueId != null ? cueById.get(cueId) : null;
  return [
    rowNum,
    q.author_name || '',
    q.body || '',
    meta?.cue || '',
    meta?.segment_name || '',
  ]
    .map(escapeCsvCell)
    .join(',');
}

/**
 * Live vMix/graphics CSV of showcase-queued questions (waiting — not ACTIVE).
 * Columns: Row,Author,Question,Cue,Segment
 * Optional opts.row (1-based) returns only that queue position.
 */
async function buildQueueCsv(db, eventId, opts = {}) {
  const cueById = await cueLookupMap(db, eventId);
  const questions = await listQuestions(db, eventId, 'all');
  let queued = questions
    .filter(
      (q) =>
        q && q.is_queued === true && q.is_overflow !== true && q.is_active !== true
    )
    .sort((a, b) => {
      const ao = Number(a.sort_order) || 0;
      const bo = Number(b.sort_order) || 0;
      if (ao !== bo) return ao - bo;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });

  const rowFilter =
    opts.row != null && String(opts.row).trim() !== '' ? Number(opts.row) : null;
  if (rowFilter != null && Number.isFinite(rowFilter) && rowFilter >= 1) {
    queued = queued.filter((_, index) => index + 1 === rowFilter);
  }

  const lines = ['Row,Author,Question,Cue,Segment'];
  queued.forEach((q, index) => {
    const rowNum =
      rowFilter != null && Number.isFinite(rowFilter) ? rowFilter : index + 1;
    lines.push(questionCsvRow(q, rowNum, cueById));
  });
  return `${lines.join('\n')}\n`;
}

/**
 * Live vMix/graphics CSV for the single on-air ACTIVE question.
 * Empty body (header only) when nothing is active.
 */
async function buildActiveCsv(db, eventId) {
  const cueById = await cueLookupMap(db, eventId);
  const active = await getActiveQuestion(db, eventId);
  const lines = ['Row,Author,Question,Cue,Segment'];
  if (active) {
    lines.push(questionCsvRow(active, 1, cueById));
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  QA_STATUSES,
  VISIBLE_SOFT_LIMIT,
  MAX_BODY_CHARS,
  ensureWebQaSchema,
  getOrCreateSession,
  getSessionByToken,
  rotateSessionToken,
  updateSession,
  listQuestions,
  submitQuestion,
  updateQuestion,
  reorderQueuedQuestions,
  deleteQuestion,
  getActiveCueContext,
  getActiveQuestion,
  syncSessionOpenFromCue,
  buildOverview,
  buildQueueCsv,
  buildActiveCsv,
  getSoftLimitState,
  isMissingRelation,
  newPublicToken,
  normalizeStatus,
  itemIsQaCue,
  formatCueDisplay,
  cueFieldValue,
};
