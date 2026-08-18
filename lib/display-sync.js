/** Per-event follower/display sync flag stored on calendar_events.schedule_data.displaySyncEnabled */

function parseScheduleData(scheduleData) {
  if (!scheduleData) return {};
  if (typeof scheduleData === 'string') {
    try {
      const parsed = JSON.parse(scheduleData);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof scheduleData === 'object' ? scheduleData : {};
}

/** undefined / missing => enabled (backward compatible) */
function isDisplaySyncEnabled(scheduleData) {
  const sd = parseScheduleData(scheduleData);
  return sd.displaySyncEnabled !== false;
}

async function loadDisplaySyncEnabled(pool, eventId) {
  if (!eventId) return true;
  const result = await pool.query(
    `SELECT schedule_data FROM calendar_events
     WHERE id::text = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [String(eventId)]
  );
  if (!result.rows.length) return true;
  return isDisplaySyncEnabled(result.rows[0].schedule_data);
}

async function setDisplaySyncEnabled(pool, calendarEventId, enabled) {
  const existing = await pool.query(
    `SELECT id, name, date, schedule_data FROM calendar_events
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [calendarEventId]
  );
  if (!existing.rows.length) {
    return { ok: false, status: 404, error: 'Calendar event not found' };
  }
  const row = existing.rows[0];
  const scheduleData = {
    ...parseScheduleData(row.schedule_data),
    displaySyncEnabled: enabled === true,
  };
  const updated = await pool.query(
    `UPDATE calendar_events
     SET schedule_data = $1::jsonb, updated_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [JSON.stringify(scheduleData), calendarEventId]
  );
  return { ok: true, row: updated.rows[0], scheduleData };
}

module.exports = {
  parseScheduleData,
  isDisplaySyncEnabled,
  loadDisplaySyncEnabled,
  setDisplaySyncEnabled,
};
