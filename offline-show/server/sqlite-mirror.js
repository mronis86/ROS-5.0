'use strict';

const {
  nowIso,
  stringifyJson,
  parseJson,
  boolToInt,
  randomUUID,
  normalizeCalendarEvent,
  normalizeRunOfShowRow,
  normalizeActiveTimer,
} = require('./db');

function upsertCalendarEvent(db, row) {
  if (!row?.id) return null;
  const schedule =
    typeof row.schedule_data === 'object'
      ? stringifyJson(row.schedule_data)
      : row.schedule_data || '{}';
  const created = row.created_at || nowIso();
  const updated = row.updated_at || nowIso();
  db.prepare(`
    INSERT INTO calendar_events (id, name, date, schedule_data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      date = excluded.date,
      schedule_data = excluded.schedule_data,
      updated_at = excluded.updated_at
  `).run(row.id, row.name, row.date, schedule, created, updated);
  return normalizeCalendarEvent(
    db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(row.id)
  );
}

function deleteCalendarEventLocal(db, calendarId) {
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(calendarId);
}

function deleteRunOfShowLocal(db, eventId) {
  db.prepare('DELETE FROM run_of_show_data WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM active_timers WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM completed_cues WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM overtime_minutes WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM timer_messages WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM indented_cues WHERE event_id = ?').run(eventId);
  db.prepare('DELETE FROM show_start_overtime WHERE event_id = ?').run(eventId);
}

function upsertRunOfShow(db, row) {
  if (!row?.event_id) return null;
  const ts = row.updated_at || row.last_change_at || nowIso();
  db.prepare(`
    INSERT INTO run_of_show_data (
      event_id, event_name, event_date, schedule_items, custom_columns, settings,
      last_modified_by, last_modified_by_name, last_modified_by_role,
      last_change_at, created_at, updated_at
    ) VALUES (
      @event_id, @event_name, @event_date, @schedule_items, @custom_columns, @settings,
      @last_modified_by, @last_modified_by_name, @last_modified_by_role,
      @last_change_at, @created_at, @updated_at
    )
    ON CONFLICT(event_id) DO UPDATE SET
      event_name = excluded.event_name,
      event_date = excluded.event_date,
      schedule_items = excluded.schedule_items,
      custom_columns = excluded.custom_columns,
      settings = excluded.settings,
      last_modified_by = excluded.last_modified_by,
      last_modified_by_name = excluded.last_modified_by_name,
      last_modified_by_role = excluded.last_modified_by_role,
      last_change_at = excluded.last_change_at,
      updated_at = excluded.updated_at
  `).run({
    event_id: row.event_id,
    event_name: row.event_name,
    event_date: row.event_date,
    schedule_items: stringifyJson(
      typeof row.schedule_items === 'string'
        ? parseJson(row.schedule_items, [])
        : row.schedule_items ?? []
    ),
    custom_columns: stringifyJson(
      typeof row.custom_columns === 'string'
        ? parseJson(row.custom_columns, [])
        : row.custom_columns ?? []
    ),
    settings: stringifyJson(
      typeof row.settings === 'string' ? parseJson(row.settings, {}) : row.settings ?? {}
    ),
    last_modified_by: row.last_modified_by,
    last_modified_by_name: row.last_modified_by_name,
    last_modified_by_role: row.last_modified_by_role,
    last_change_at: row.last_change_at || ts,
    created_at: row.created_at || ts,
    updated_at: ts,
  });
  return normalizeRunOfShowRow(
    db.prepare('SELECT * FROM run_of_show_data WHERE event_id = ?').get(row.event_id)
  );
}

function upsertActiveTimer(db, timer) {
  if (!timer?.event_id || timer.item_id == null) return null;
  const ts = nowIso();
  const timerState =
    timer.timer_state ||
    (timer.is_running ? 'running' : timer.is_active ? 'loaded' : 'stopped');
  let startedAt = timer.started_at;
  if (timerState === 'running' && (!startedAt || startedAt === 'null')) {
    startedAt = ts;
  } else if (timerState !== 'running' && (!startedAt || startedAt === 'null')) {
    startedAt = '2099-12-31T23:59:59.999Z';
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO active_timers (
      id, event_id, item_id, user_id, user_name, user_role, timer_state,
      is_active, is_running, started_at, last_loaded_cue_id, cue_is,
      duration_seconds, elapsed_seconds, created_at, updated_at
    ) VALUES (
      @id, @event_id, @item_id, @user_id, @user_name, @user_role, @timer_state,
      @is_active, @is_running, @started_at, @last_loaded_cue_id, @cue_is,
      @duration_seconds, @elapsed_seconds, @created_at, @updated_at
    )
    ON CONFLICT(event_id) DO UPDATE SET
      item_id = excluded.item_id,
      user_id = excluded.user_id,
      user_name = excluded.user_name,
      user_role = excluded.user_role,
      timer_state = excluded.timer_state,
      is_active = excluded.is_active,
      is_running = excluded.is_running,
      started_at = excluded.started_at,
      last_loaded_cue_id = excluded.last_loaded_cue_id,
      cue_is = excluded.cue_is,
      duration_seconds = excluded.duration_seconds,
      elapsed_seconds = excluded.elapsed_seconds,
      updated_at = excluded.updated_at
  `).run({
    id,
    event_id: timer.event_id,
    item_id: String(timer.item_id),
    user_id: timer.user_id || null,
    user_name: timer.user_name || 'Unknown User',
    user_role: timer.user_role || 'OPERATOR',
    timer_state: timerState,
    is_active: boolToInt(timer.is_active),
    is_running: boolToInt(timer.is_running),
    started_at: startedAt,
    last_loaded_cue_id:
      timer.last_loaded_cue_id != null ? String(timer.last_loaded_cue_id) : null,
    cue_is: timer.cue_is || null,
    duration_seconds: timer.duration_seconds ?? 300,
    elapsed_seconds: timer.elapsed_seconds ?? 0,
    created_at: ts,
    updated_at: ts,
  });
  return normalizeActiveTimer(
    db.prepare('SELECT * FROM active_timers WHERE event_id = ?').get(timer.event_id)
  );
}

function logicalEventId(calendarRow) {
  let sd = calendarRow.schedule_data;
  if (typeof sd === 'string') sd = parseJson(sd, {});
  if (sd && typeof sd === 'object' && sd.eventId) return String(sd.eventId);
  return calendarRow.id;
}

module.exports = {
  upsertCalendarEvent,
  deleteCalendarEventLocal,
  deleteRunOfShowLocal,
  upsertRunOfShow,
  upsertActiveTimer,
  logicalEventId,
};
