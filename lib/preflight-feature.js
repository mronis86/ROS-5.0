/** Per-event Pre-Flight checklist flag on calendar_events.schedule_data.preflightChecklistEnabled */

function parseScheduleData(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function readEnabledFromScheduleData(scheduleData) {
  const sd = parseScheduleData(scheduleData);
  return sd.preflightChecklistEnabled === true;
}

async function loadPreflightChecklistEnabled(pool, eventId) {
  if (!eventId) return false;
  const result = await pool.query(
    `SELECT schedule_data FROM calendar_events
     WHERE id::text = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [String(eventId)]
  );
  if (!result.rows.length) return false;
  return readEnabledFromScheduleData(result.rows[0].schedule_data);
}

async function setPreflightChecklistEnabled(pool, calendarEventId, enabled) {
  const id = String(calendarEventId);
  const existing = await pool.query(
    `SELECT id, schedule_data FROM calendar_events
     WHERE id::text = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [id]
  );
  if (!existing.rows.length) {
    return { ok: false, status: 404, error: 'Calendar event not found' };
  }

  const sd = parseScheduleData(existing.rows[0].schedule_data);
  const next = {
    ...sd,
    preflightChecklistEnabled: enabled === true,
  };

  await pool.query(
    `UPDATE calendar_events
     SET schedule_data = $1::jsonb, updated_at = NOW()
     WHERE id::text = $2`,
    [JSON.stringify(next), id]
  );

  return { ok: true, preflightChecklistEnabled: enabled === true };
}

module.exports = {
  readEnabledFromScheduleData,
  loadPreflightChecklistEnabled,
  setPreflightChecklistEnabled,
};
