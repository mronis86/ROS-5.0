/**
 * Normalize and resolve run_of_show_data.event_date from save payload,
 * existing row, or calendar_events (source of truth for event list dates).
 */

function formatDateOnly(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return s.slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  try {
    const s = String(value).trim();
    return s ? s.slice(0, 10) : null;
  } catch {
    return null;
  }
}

function isValidDateKey(value) {
  const key = formatDateOnly(value);
  return !!(key && /^\d{4}-\d{2}-\d{2}$/.test(key));
}

/** SQL fragment: only rows with a parseable upcoming event_date. */
const UPCOMING_ROS_EVENT_DATE_SQL = `
  event_date IS NOT NULL
  AND TRIM(event_date::text) <> ''
  AND event_date::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
  AND event_date::date >= CURRENT_DATE
`;

async function getCalendarEventDate(pool, eventId) {
  if (!pool || !eventId) return null;
  try {
    const r = await pool.query(
      `SELECT date FROM calendar_events
       WHERE id::text = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [String(eventId)]
    );
    return formatDateOnly(r.rows[0]?.date);
  } catch {
    return null;
  }
}

/**
 * Pick event_date for run_of_show_data saves:
 * 1) non-empty incoming from client
 * 2) existing row
 * 3) calendar_events.date for this event_id
 */
async function resolveRunOfShowEventDate(pool, eventId, { incoming, existingRow } = {}) {
  const fromIncoming = formatDateOnly(incoming);
  if (fromIncoming) return fromIncoming;
  const fromExisting = formatDateOnly(existingRow?.event_date);
  if (fromExisting) return fromExisting;
  return getCalendarEventDate(pool, eventId);
}

/** Backfill blank run_of_show_data.event_date from calendar_events. */
async function backfillBlankRunOfShowEventDates(pool) {
  const r = await pool.query(
    `UPDATE run_of_show_data AS ros
     SET event_date = ce.date, updated_at = NOW()
     FROM calendar_events AS ce
     WHERE ce.id::text = ros.event_id::text
       AND ce.deleted_at IS NULL
       AND ce.date IS NOT NULL
       AND TRIM(ce.date::text) <> ''
       AND (ros.event_date IS NULL OR TRIM(ros.event_date::text) = '')
     RETURNING ros.event_id::text AS event_id`
  );
  return r.rows?.length || 0;
}

module.exports = {
  formatDateOnly,
  isValidDateKey,
  UPCOMING_ROS_EVENT_DATE_SQL,
  getCalendarEventDate,
  resolveRunOfShowEventDate,
  backfillBlankRunOfShowEventDates,
};
