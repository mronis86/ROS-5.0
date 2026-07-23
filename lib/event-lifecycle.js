/**
 * Soft-delete / restore for calendar_events, plus orphan discovery and permanent purge.
 * Calendar delete must NOT wipe run_of_show_data or related event-scoped rows.
 */

const RELATED_TABLES = [
  { table: 'run_of_show_data', column: 'event_id' },
  { table: 'content_review_data', column: 'event_id' },
  { table: 'active_timers', column: 'event_id' },
  { table: 'sub_cue_timers', column: 'event_id' },
  { table: 'completed_cues', column: 'event_id' },
  { table: 'overtime_minutes', column: 'event_id' },
  { table: 'show_start_overtime', column: 'event_id' },
  { table: 'indented_cues', column: 'event_id' },
  { table: 'timer_messages', column: 'event_id' },
  { table: 'timer_actions', column: 'event_id' },
  { table: 'change_log', column: 'event_id' },
  { table: 'change_log_batches', column: 'event_id' },
  { table: 'user_event_notes', column: 'event_id' },
  { table: 'run_of_show_backups', column: 'event_id' },
  { table: 'api_user_event_access', column: 'event_id' },
];

async function ensureCalendarSoftDeleteSchema(pool) {
  await pool.query(`
    ALTER TABLE public.calendar_events
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_calendar_events_deleted_at
      ON public.calendar_events (deleted_at)
      WHERE deleted_at IS NOT NULL
  `);
}

function normalizeScheduleData(sd) {
  if (typeof sd === 'string') {
    try {
      return JSON.parse(sd) || {};
    } catch {
      return {};
    }
  }
  return sd && typeof sd === 'object' ? sd : {};
}

/** All id strings that count as “still have a calendar row” (active or soft-deleted). */
async function loadCalendarIdSet(pool) {
  const result = await pool.query('SELECT id, schedule_data FROM calendar_events');
  const ids = new Set();
  for (const row of result.rows || []) {
    if (row.id != null) ids.add(String(row.id));
    const sd = normalizeScheduleData(row.schedule_data);
    if (sd.eventId) ids.add(String(sd.eventId));
  }
  return ids;
}

async function tableExists(pool, tableName) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return r.rows.length > 0;
}

async function softDeleteCalendarEvent(pool, id) {
  const result = await pool.query(
    `UPDATE calendar_events
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

async function restoreCalendarEvent(pool, id) {
  const result = await pool.query(
    `UPDATE calendar_events
     SET deleted_at = NULL, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

async function listDeletedCalendarEvents(pool) {
  const result = await pool.query(
    `SELECT id, name, date, schedule_data, created_at, updated_at, deleted_at
     FROM calendar_events
     WHERE deleted_at IS NOT NULL
     ORDER BY deleted_at DESC`
  );
  return (result.rows || []).map((row) => {
    const sd = normalizeScheduleData(row.schedule_data);
    return {
      id: String(row.id),
      name: row.name || 'Untitled event',
      date: row.date,
      location: sd.location || '',
      eventId: sd.eventId || null,
      deletedAt: row.deleted_at,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    };
  });
}

async function countRelatedForEventIds(pool, eventIds) {
  const counts = {};
  for (const id of eventIds) counts[id] = {};

  for (const { table, column } of RELATED_TABLES) {
    if (!(await tableExists(pool, table))) continue;
    try {
      const r = await pool.query(
        `SELECT ${column}::text AS eid, COUNT(*)::int AS c
         FROM ${table}
         WHERE ${column}::text = ANY($1)
         GROUP BY ${column}::text`,
        [eventIds]
      );
      for (const row of r.rows || []) {
        const eid = String(row.eid);
        if (!counts[eid]) counts[eid] = {};
        counts[eid][table] = row.c;
      }
    } catch (err) {
      // Skip tables that exist but lack the expected column/shape.
      console.warn(`[event-lifecycle] count skip ${table}:`, err.message || err);
    }
  }
  return counts;
}

/**
 * Soft-deleted calendar rows (still restorable) with attached data counts.
 */
async function listSoftDeletedWithCounts(pool) {
  const deleted = await listDeletedCalendarEvents(pool);
  const candidateIds = [];
  for (const ev of deleted) {
    candidateIds.push(ev.id);
    if (ev.eventId) candidateIds.push(String(ev.eventId));
  }
  const unique = [...new Set(candidateIds)];
  const counts = unique.length ? await countRelatedForEventIds(pool, unique) : {};

  return deleted.map((ev) => {
    const merged = { ...(counts[ev.id] || {}) };
    if (ev.eventId && counts[ev.eventId]) {
      for (const [k, v] of Object.entries(counts[ev.eventId])) {
        merged[k] = (merged[k] || 0) + v;
      }
    }
    const totalRows = Object.values(merged).reduce((a, b) => a + b, 0);
    return { ...ev, relatedCounts: merged, relatedTotal: totalRows };
  });
}

/**
 * Data keyed by event_id with no matching calendar_events row (including soft-deleted).
 * These are leftovers from older hard deletes.
 */
async function findOrphanEventData(pool) {
  const calendarIds = await loadCalendarIdSet(pool);
  const orphanMap = new Map(); // eventId -> { tables: { name: count } }

  for (const { table, column } of RELATED_TABLES) {
    if (!(await tableExists(pool, table))) continue;
    try {
      const r = await pool.query(
        `SELECT ${column}::text AS eid, COUNT(*)::int AS c
         FROM ${table}
         WHERE ${column} IS NOT NULL
         GROUP BY ${column}::text`
      );
      for (const row of r.rows || []) {
        const eid = String(row.eid || '').trim();
        if (!eid || calendarIds.has(eid)) continue;
        if (!orphanMap.has(eid)) orphanMap.set(eid, { eventId: eid, relatedCounts: {}, relatedTotal: 0 });
        const entry = orphanMap.get(eid);
        entry.relatedCounts[table] = row.c;
        entry.relatedTotal += row.c;
      }
    } catch (err) {
      console.warn(`[event-lifecycle] orphan scan skip ${table}:`, err.message || err);
    }
  }

  return [...orphanMap.values()].sort((a, b) => b.relatedTotal - a.relatedTotal);
}

/**
 * Permanently delete related rows for an event id (and optional legacy linked id).
 * Optionally hard-delete the calendar row.
 */
async function purgeEventData(pool, { eventId, linkedIds = [], deleteCalendarRow = false } = {}) {
  const ids = [...new Set([String(eventId), ...linkedIds.map(String)].filter(Boolean))];
  if (!ids.length) {
    return { deleted: {}, calendarDeleted: false };
  }

  const deleted = {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { table, column } of RELATED_TABLES) {
      if (!(await tableExists(client, table))) continue;
      try {
        const r = await client.query(
          `DELETE FROM ${table} WHERE ${column}::text = ANY($1)`,
          [ids]
        );
        if (r.rowCount > 0) deleted[table] = r.rowCount;
      } catch (err) {
        console.warn(`[event-lifecycle] purge skip ${table}:`, err.message || err);
      }
    }

    let calendarDeleted = false;
    if (deleteCalendarRow) {
      const r = await client.query(
        `DELETE FROM calendar_events WHERE id::text = ANY($1)`,
        [ids]
      );
      calendarDeleted = r.rowCount > 0;
    }

    await client.query('COMMIT');
    return { deleted, calendarDeleted, ids };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  RELATED_TABLES,
  ensureCalendarSoftDeleteSchema,
  softDeleteCalendarEvent,
  restoreCalendarEvent,
  listDeletedCalendarEvents,
  listSoftDeletedWithCounts,
  findOrphanEventData,
  purgeEventData,
  normalizeScheduleData,
};
