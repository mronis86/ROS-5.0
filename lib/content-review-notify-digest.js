/**
 * Debounced content review digest emails for event assignees.
 * After activity, waits for a quiet period (default 5 min) then emails a todo snapshot.
 */

const { getNotifyRecipientsForRole } = require('./content-review-assignees');
const { diffReviewNotifications, recipientsForEvent } = require('./content-review-notify');
const { notifyContentReviewDigest } = require('./admin-notify-email');

const DEFAULT_DEBOUNCE_MINUTES = 5;
/** Retry delay when digest send fails (no constant Neon polling). */
const DIGEST_RETRY_MS = 60_000;

/** Per-assignee timers — armed on content review activity, idle when queue is empty. */
const digestTimersByAccessId = new Map();
const digestInFlightByAccessId = new Set();

function debounceMinutes() {
  const raw = parseInt(process.env.CONTENT_REVIEW_NOTIFY_DEBOUNCE_MINUTES || '', 10);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 120) return raw;
  return DEFAULT_DEBOUNCE_MINUTES;
}

async function ensureNotifyPendingTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.content_review_notify_pending (
      access_id UUID PRIMARY KEY REFERENCES public.api_user_access(id) ON DELETE CASCADE,
      notify_after TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_content_review_notify_pending_due
      ON public.content_review_notify_pending (notify_after)
  `);
}

function msUntilNotifyAfter(notifyAfter) {
  const t = new Date(notifyAfter).getTime();
  if (Number.isNaN(t)) return debounceMinutes() * 60 * 1000;
  return Math.max(0, t - Date.now());
}

function clearDigestTimer(accessId) {
  const id = String(accessId);
  const existing = digestTimersByAccessId.get(id);
  if (existing) {
    clearTimeout(existing);
    digestTimersByAccessId.delete(id);
  }
}

function armDigestTimer(pool, accessId, delayMs) {
  const id = String(accessId);
  clearDigestTimer(id);
  const waitMs = Math.max(0, Number(delayMs) || 0);
  const timer = setTimeout(() => {
    digestTimersByAccessId.delete(id);
    void processDigestForAccessId(pool, id);
  }, waitMs);
  digestTimersByAccessId.set(id, timer);
}

async function scheduleDigestForAccessIds(pool, accessIds) {
  const ids = [...new Set((accessIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return;

  const minutes = debounceMinutes();
  await pool.query(
    `INSERT INTO public.content_review_notify_pending (access_id, notify_after, updated_at)
     SELECT unnest($1::uuid[]), NOW() + ($2::int * INTERVAL '1 minute'), NOW()
     ON CONFLICT (access_id) DO UPDATE SET
       notify_after = NOW() + ($2::int * INTERVAL '1 minute'),
       updated_at = NOW()`,
    [ids, minutes]
  );

  const pending = await pool.query(
    `SELECT access_id, notify_after
     FROM public.content_review_notify_pending
     WHERE access_id = ANY($1::uuid[])`,
    [ids]
  );
  for (const row of pending.rows || []) {
    armDigestTimer(pool, row.access_id, msUntilNotifyAfter(row.notify_after));
  }
}

async function collectRecipientAccessIdsForReviewChange(pool, {
  eventId,
  beforeReviews,
  afterReviews,
  modifierAccessId,
}) {
  const diffEvents = diffReviewNotifications(beforeReviews, afterReviews);
  if (!diffEvents.length) return [];

  const rolesNeeded = new Set();
  for (const event of diffEvents) {
    const target = recipientsForEvent(event);
    if (target?.role) rolesNeeded.add(target.role);
  }
  if (!rolesNeeded.size) return [];

  const accessIds = new Set();
  for (const role of rolesNeeded) {
    const recipients = await getNotifyRecipientsForRole(pool, eventId, role, modifierAccessId);
    for (const recipient of recipients) {
      accessIds.add(String(recipient.access_id));
    }
  }
  return [...accessIds];
}

async function scheduleContentReviewDigestNotifications(pool, opts) {
  if (!opts?.eventId) return;
  try {
    const accessIds = await collectRecipientAccessIdsForReviewChange(pool, opts);
    if (!accessIds.length) return;
    await scheduleDigestForAccessIds(pool, accessIds);
  } catch (err) {
    console.warn('[content-review-notify-digest] schedule failed:', err.message || err);
  }
}

function listStageComments(stage) {
  if (!stage || typeof stage !== 'object') return [];
  if (Array.isArray(stage.comments) && stage.comments.length > 0) {
    return stage.comments.filter((c) => c && String(c.text || '').trim());
  }
  const legacy = String(stage.note ?? '').trim();
  if (!legacy) return [];
  return [{ text: legacy }];
}

function listResponseComments(stage) {
  if (!stage || typeof stage !== 'object') return [];
  if (Array.isArray(stage.responseComments) && stage.responseComments.length > 0) {
    return stage.responseComments.filter((c) => c && String(c.text || '').trim());
  }
  const legacy = String(stage.response ?? '').trim();
  if (!legacy) return [];
  return [{ text: legacy }];
}

function isCueFullyApproved(entry) {
  return (
    (entry?.creative?.status || 'pending') === 'approved' &&
    (entry?.ros?.status || 'pending') === 'approved'
  );
}

function hasReviewerComments(entry) {
  return (
    listStageComments(entry?.creative).length > 0 || listStageComments(entry?.ros).length > 0
  );
}

function hasCreativeResponses(entry) {
  return listResponseComments(entry?.creative).length > 0;
}

function cueNeedsCreativeAction(entry) {
  if (!entry || isCueFullyApproved(entry)) return null;
  const creative = entry?.creative?.status || 'pending';
  const ros = entry?.ros?.status || 'pending';
  if (creative === 'needs_update' || ros === 'needs_update') {
    return describeCreativeTodo(entry);
  }
  if (hasReviewerComments(entry) && creative !== 'edits_made') {
    return 'Production review notes';
  }
  return null;
}

function cueNeedsProductionAction(entry) {
  if (!entry || isCueFullyApproved(entry)) return null;
  const creative = entry?.creative?.status || 'pending';
  if (creative === 'edits_made') {
    return 'Edits made — re-review needed';
  }
  if (hasCreativeResponses(entry)) {
    return 'Creative response — re-review needed';
  }
  return null;
}

function describeCreativeTodo(entry) {
  const creative = entry?.creative?.status || 'pending';
  const ros = entry?.ros?.status || 'pending';
  if (creative === 'needs_update' && ros === 'needs_update') return 'Needs Review (Creative & ROS)';
  if (ros === 'needs_update') return 'Needs Review (ROS Show)';
  if (creative === 'needs_update') return 'Needs Review (Creative Content)';
  return 'Needs Review';
}

function formatCueLabel(item, index) {
  const num = index + 1;
  const name = String(item?.segmentName ?? item?.segment_name ?? '').trim();
  return name ? `Cue ${num} — ${name}` : `Cue ${num}`;
}

function buildActionableCues(scheduleItems, reviews, role) {
  const cues = [];
  for (let index = 0; index < (scheduleItems || []).length; index += 1) {
    const item = scheduleItems[index];
    const key = String(item.id);
    const entry = reviews?.[key] ?? reviews?.[item.id] ?? null;
    if (!entry) continue;

    let reason = null;
    if (role === 'creative') {
      reason = cueNeedsCreativeAction(entry);
    } else if (role === 'production') {
      reason = cueNeedsProductionAction(entry);
    }
    if (reason) {
      cues.push({ cueId: key, label: formatCueLabel(item, index), reason });
    }
  }
  return cues;
}

async function resolveContentReviewEventData(pool, calendarEventId) {
  const calRes = await pool.query(
    `SELECT id, name, date, schedule_data
     FROM calendar_events
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [calendarEventId]
  );
  const cal = calRes.rows[0];
  if (!cal) return null;

  const sd = cal.schedule_data && typeof cal.schedule_data === 'object' ? cal.schedule_data : {};
  const candidateIds = [...new Set([String(calendarEventId), sd.eventId].filter(Boolean))];

  let scheduleItems = [];
  let reviews = {};

  for (const id of candidateIds) {
    const rosRes = await pool.query(
      `SELECT schedule_items FROM run_of_show_data WHERE event_id = $1 LIMIT 1`,
      [id]
    );
    const items = rosRes.rows[0]?.schedule_items;
    if (Array.isArray(items) && items.length > 0) {
      scheduleItems = items;
      break;
    }
  }

  for (const id of candidateIds) {
    const revRes = await pool.query(
      `SELECT reviews FROM content_review_data WHERE event_id = $1 LIMIT 1`,
      [id]
    );
    if (revRes.rows[0]) {
      reviews = revRes.rows[0].reviews || {};
      break;
    }
  }

  const eventDate =
    typeof cal.date === 'string'
      ? cal.date.slice(0, 10)
      : cal.date instanceof Date
        ? cal.date.toISOString().slice(0, 10)
        : String(cal.date || '').slice(0, 10);

  return {
    eventId: String(calendarEventId),
    eventName: cal.name || 'Event',
    eventDate,
    scheduleItems,
    reviews,
  };
}

async function buildDigestForAssignee(pool, accessId) {
  const assigneeRes = await pool.query(
    `SELECT a.event_id, a.assignee_role, u.email, u.full_name
     FROM public.event_content_review_assignees a
     JOIN public.api_user_access u ON u.id = a.access_id
     WHERE a.access_id = $1
       AND a.notify_on_change = TRUE
       AND u.status = 'approved'
       AND u.email IS NOT NULL AND TRIM(u.email) <> ''`,
    [accessId]
  );
  const rows = assigneeRes.rows || [];
  if (!rows.length) return null;

  const events = [];
  for (const row of rows) {
    const context = await resolveContentReviewEventData(pool, row.event_id);
    if (!context) continue;
    const cues = buildActionableCues(context.scheduleItems, context.reviews, row.assignee_role);
    if (!cues.length) continue;
    events.push({
      eventId: context.eventId,
      eventName: context.eventName,
      eventDate: context.eventDate,
      role: row.assignee_role,
      cues,
    });
  }

  if (!events.length) return null;

  events.sort((a, b) => {
    const dateCmp = String(a.eventDate).localeCompare(String(b.eventDate));
    if (dateCmp !== 0) return dateCmp;
    return String(a.eventName).localeCompare(String(b.eventName));
  });

  return {
    email: rows[0].email,
    fullName: rows[0].full_name || '',
    events,
  };
}

async function claimDueDigestAccessIds(pool, limit = 25) {
  const r = await pool.query(
    `SELECT access_id
     FROM public.content_review_notify_pending
     WHERE notify_after <= NOW()
     ORDER BY notify_after ASC
     LIMIT $1`,
    [limit]
  );
  return (r.rows || []).map((row) => String(row.access_id));
}

async function clearPendingDigest(pool, accessId) {
  await pool.query(`DELETE FROM public.content_review_notify_pending WHERE access_id = $1`, [accessId]);
}

async function processDigestForAccessId(pool, accessId) {
  const id = String(accessId);
  if (digestInFlightByAccessId.has(id)) return false;
  digestInFlightByAccessId.add(id);
  try {
    const pending = await pool.query(
      `SELECT notify_after FROM public.content_review_notify_pending WHERE access_id = $1 LIMIT 1`,
      [id]
    );
    if (!pending.rows.length) return false;

    const waitMs = msUntilNotifyAfter(pending.rows[0].notify_after);
    if (waitMs > 0) {
      armDigestTimer(pool, id, waitMs);
      return false;
    }

    const digest = await buildDigestForAssignee(pool, id);
    if (!digest) {
      await clearPendingDigest(pool, id);
      return false;
    }
    await notifyContentReviewDigest(digest);
    await clearPendingDigest(pool, id);
    console.log(`[content-review-notify-digest] Sent digest to ${digest.email}`);
    return true;
  } catch (err) {
    console.warn(`[content-review-notify-digest] send failed for ${id}:`, err.message || err);
    armDigestTimer(pool, id, DIGEST_RETRY_MS);
    return false;
  } finally {
    digestInFlightByAccessId.delete(id);
  }
}

/** Batch due digests (tests / manual scripts). Normal runtime uses per-assignee timers. */
async function processDueContentReviewDigests(pool) {
  const accessIds = await claimDueDigestAccessIds(pool);
  if (!accessIds.length) return 0;

  let sent = 0;
  for (const accessId of accessIds) {
    if (await processDigestForAccessId(pool, accessId)) {
      sent += 1;
    }
  }
  if (sent > 0) {
    console.log(`[content-review-notify-digest] Sent ${sent} digest email(s)`);
  }
  return sent;
}

async function recoverPendingDigestTimers(pool) {
  const r = await pool.query(
    `SELECT access_id, notify_after FROM public.content_review_notify_pending`
  );
  const rows = r.rows || [];
  for (const row of rows) {
    armDigestTimer(pool, row.access_id, msUntilNotifyAfter(row.notify_after));
  }
  if (rows.length > 0) {
    console.log(
      `[content-review-notify-digest] Re-armed ${rows.length} pending digest timer(s) after boot`
    );
  }
}

function startContentReviewDigestWorker(pool) {
  void recoverPendingDigestTimers(pool).catch((err) => {
    console.warn('[content-review-notify-digest] boot recovery failed:', err.message || err);
  });
}

module.exports = {
  debounceMinutes,
  ensureNotifyPendingTable,
  scheduleContentReviewDigestNotifications,
  scheduleDigestForAccessIds,
  collectRecipientAccessIdsForReviewChange,
  buildActionableCues,
  buildDigestForAssignee,
  processDueContentReviewDigests,
  processDigestForAccessId,
  recoverPendingDigestTimers,
  startContentReviewDigestWorker,
};
