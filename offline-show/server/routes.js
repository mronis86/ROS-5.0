'use strict';

const {
  nowIso,
  randomUUID,
  stringifyJson,
  parseJson,
  boolToInt,
  intToBool,
  normalizeCalendarEvent,
  normalizeRunOfShowRow,
  normalizeActiveTimer,
  normalizeTimerMessage,
} = require('./db');
const { probeConnectivity, clearConnectivityCache, probeRailwayReachable } = require('./connectivity');
const { getCloudMode, setCloudMode, MODES } = require('./cloud-mode');
const {
  getRailwayApiToken,
  getRailwayApiTokenStatus,
  setRailwayApiToken,
  clearRailwayApiToken,
} = require('./railway-api-token');
const { validateRailwayApiToken } = require('./railway-client');
const cloud = require('./cloud-data');
const { pushReconnectSnapshotToRailway } = require('./cloud-reconnect-push');
const { installCloudProxy } = require('./cloud-proxy');
const { registerMediaSyncRoutes, applyMediaSyncMeta } = require('./media-sync-routes');

function friendlyError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('<!DOCTYPE') || msg.includes('<html')) {
    const pre = msg.match(/<pre>([^<]+)/i);
    return pre ? pre[1].trim() : 'Cloud server returned an unexpected error';
  }
  return msg.length > 240 ? `${msg.slice(0, 240)}…` : msg;
}

function registerRoutes(app, db, helpers) {
  const broadcastUpdateRaw = helpers.broadcastUpdate;
  const broadcastCloudMode = helpers.broadcastCloudMode;

  // Inject Resolume/Mitti armed/synced meta onto timer socket payloads (LAN)
  function broadcastUpdate(eventId, updateType, data) {
    let payload = data;
    if (updateType === 'timerUpdated' && data) {
      payload = applyMediaSyncMeta(eventId, data, { isSubCue: false });
    } else if (updateType === 'subCueTimerStarted' && data) {
      payload = applyMediaSyncMeta(eventId, data, { isSubCue: true });
    }
    return broadcastUpdateRaw(eventId, updateType, payload);
  }

  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      mode: 'offline-show',
      phase: 2,
      db: 'sqlite',
      timestamp: nowIso(),
    });
  });

  app.get('/api/connectivity-status', async (_req, res) => {
    try {
      const status = await probeConnectivity(db);
      res.json(status);
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : 'Connectivity probe failed',
        timestamp: nowIso(),
      });
    }
  });

  app.get('/api/monitor/snapshot', (req, res) => {
    try {
      const timerRows = db
        .prepare(
          `SELECT at.event_id, at.item_id, at.cue_is, at.started_at, ce.name AS event_name
           FROM active_timers at
           LEFT JOIN calendar_events ce ON ce.id = at.event_id
           WHERE at.timer_state = 'running' OR (at.is_active = 1 AND at.is_running = 1)
           ORDER BY at.updated_at DESC
           LIMIT 20`
        )
        .all();
      const runningTimers = timerRows.map((row) => ({
        eventId: String(row.event_id),
        eventName: row.event_name || `Event ${row.event_id}`,
        cueIs: row.cue_is || `CUE ${row.item_id}`,
        startedAt: row.started_at || null,
      }));
      const cloud = getCloudMode(db);
      res.json({
        timestamp: nowIso(),
        ops: {
          activeEventCount: runningTimers.length > 0 ? new Set(runningTimers.map((t) => t.eventId)).size : 0,
          totalViewers: null,
          socketConnections: null,
          events: [],
          runningTimers,
          cloudMode: cloud.mode,
          lanOnly: cloud.lanOnly,
        },
      });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : 'Monitor snapshot failed',
        timestamp: nowIso(),
      });
    }
  });

  app.get('/api/cloud-mode', (_req, res) => {
    res.json(getCloudMode(db));
  });

  app.get('/api/railway-api-token', (_req, res) => {
    res.json(getRailwayApiTokenStatus(db));
  });

  app.put('/api/railway-api-token', async (req, res) => {
    const { token } = req.body || {};
    const status = getRailwayApiTokenStatus(db);
    if (status.locked) {
      return res.status(400).json({
        error: 'Token is set via OFFLINE_RAILWAY_API_TOKEN on the show server — update that env var instead.',
      });
    }
    try {
      const check = await validateRailwayApiToken(token);
      if (!check.ok) {
        return res.status(400).json({ error: check.error || 'Token validation failed' });
      }
      const saved = setRailwayApiToken(db, token);
      res.json(saved);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Could not save token' });
    }
  });

  app.delete('/api/railway-api-token', (_req, res) => {
    try {
      res.json(clearRailwayApiToken(db));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Could not clear token' });
    }
  });

  app.patch('/api/cloud-mode', async (req, res) => {
    const { mode, updatedBy } = req.body || {};
    if (mode !== MODES.LAN_ONLY && mode !== MODES.CLOUD_CONNECTED) {
      return res.status(400).json({
        error: 'mode must be "lan-only" or "cloud-connected"',
      });
    }
    try {
      let sync = null;
      if (mode === MODES.CLOUD_CONNECTED) {
        await probeRailwayReachable();
        sync = { direction: 'enable-only' };
      }
      const payload = setCloudMode(db, mode, { updatedBy });
      clearConnectivityCache();
      if (typeof broadcastCloudMode === 'function') {
        broadcastCloudMode({ ...payload, sync });
      }
      res.json({ ...payload, sync });
    } catch (e) {
      res.status(502).json({
        error: friendlyError(e),
        hint: 'Could not reach Railway. Stay on LAN only or check Internet.',
      });
    }
  });

  /** Upload offline snapshot to Railway, then enable cloud — single atomic reconnect. */
  app.patch('/api/cloud-mode/reconnect', async (req, res) => {
    if (getCloudMode(db).cloudConnected) {
      return res.status(400).json({ error: 'Already cloud connected' });
    }
    const { updatedBy, ...snapshot } = req.body || {};
    try {
      await probeRailwayReachable();
      if (!getRailwayApiToken(db)) {
        return res.status(400).json({
          error: 'Railway API token is not configured. Open API token settings in the connectivity bar and paste an Integration token (read + control).',
        });
      }
      const pushStats = await pushReconnectSnapshotToRailway(db, snapshot);
      const payload = setCloudMode(db, MODES.CLOUD_CONNECTED, { updatedBy });
      clearConnectivityCache();
      const sync = { direction: 'push-then-connect', ...pushStats };
      if (typeof broadcastCloudMode === 'function') {
        broadcastCloudMode({ ...payload, sync });
      }
      res.json({ ...payload, sync });
    } catch (e) {
      res.status(502).json({
        error: friendlyError(e),
        hint: 'Upload to cloud failed. Stay on LAN only and try again.',
      });
    }
  });

  app.post('/api/sync-from-cloud', async (req, res) => {
    if (!cloud.isCloudConnected(db)) {
      return res.status(400).json({ error: 'Enable Cloud on first' });
    }
    try {
      const sync = await cloud.syncFromCloud(db);
      res.json(sync);
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : 'Sync failed' });
    }
  });

  /** Push offline snapshot to Railway while still LAN-only (before cloud proxy). */
  app.post('/api/reconnect-push', async (req, res) => {
    if (getCloudMode(db).cloudConnected) {
      return res.status(400).json({ error: 'Already cloud connected' });
    }
    try {
      const stats = await pushReconnectSnapshotToRailway(db, req.body);
      res.json(stats);
    } catch (e) {
      res.status(502).json({ error: friendlyError(e) });
    }
  });

  // Cloud on: forward /api/* to Railway/Neon (same paths as main app). LAN only falls through to SQLite routes below.
  installCloudProxy(app, db, broadcastUpdate);

  // LAN companion media sync (Resolume + Mitti). Skipped when cloud proxy handles the request.
  registerMediaSyncRoutes(app, db, { broadcastUpdate, normalizeActiveTimer });

  // ─── Calendar events (LAN only — cloud mode handled by proxy above) ───────
  app.get('/api/calendar-events', async (_req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM calendar_events ORDER BY date DESC').all();
      res.json(rows.map(normalizeCalendarEvent));
    } catch (e) {
      console.error('GET calendar-events:', e);
      res.status(500).json({
        error: e instanceof Error ? e.message : 'Failed to fetch calendar events',
      });
    }
  });

  app.get('/api/calendar-events/:id', async (req, res) => {
    try {
      const row = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Event not found' });
      res.json(normalizeCalendarEvent(row));
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'Failed' });
    }
  });

  app.post('/api/calendar-events', async (req, res) => {
    const { name, date, schedule_data } = req.body || {};
    try {
      const id = randomUUID();
      const ts = nowIso();
      db.prepare(`
        INSERT INTO calendar_events (id, name, date, schedule_data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, name, date, stringifyJson(schedule_data || {}), ts, ts);
      const row = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
      res.status(201).json(normalizeCalendarEvent(row));
    } catch (e) {
      console.error('POST calendar-events:', e);
      res.status(500).json({
        error: e instanceof Error ? e.message : 'Failed to create event',
      });
    }
  });

  app.put('/api/calendar-events/:id', async (req, res) => {
    const { name, date, schedule_data } = req.body || {};
    try {
      const ts = nowIso();
      const r = db.prepare(`
        UPDATE calendar_events SET name = ?, date = ?, schedule_data = ?, updated_at = ?
        WHERE id = ?
      `).run(name, date, stringifyJson(schedule_data || {}), ts, req.params.id);
      if (r.changes === 0) return res.status(404).json({ error: 'Event not found' });
      const row = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(req.params.id);
      res.json(normalizeCalendarEvent(row));
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : 'Failed to update event',
      });
    }
  });

  app.delete('/api/calendar-events/:id', async (req, res) => {
    const eventId = req.params.id;
    try {
      const r = db.prepare('DELETE FROM calendar_events WHERE id = ?').run(eventId);
      if (r.changes === 0) return res.status(404).json({ error: 'Event not found' });
      db.prepare('DELETE FROM run_of_show_data WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM active_timers WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM completed_cues WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM overtime_minutes WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM timer_messages WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM indented_cues WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM show_start_overtime WHERE event_id = ?').run(eventId);
      res.json({ message: 'Event deleted' });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : 'Failed to delete event',
      });
    }
  });

  // ─── Show mode (stored in run_of_show_data.settings) ──────────────────────
  app.get('/api/show-mode/:eventId', (req, res) => {
    const row = db
      .prepare('SELECT settings FROM run_of_show_data WHERE event_id = ?')
      .get(req.params.eventId);
    if (!row) return res.json({ showMode: 'rehearsal', trackWasDurations: false });
    const settings = parseJson(row.settings, {});
    const showMode =
      settings.show_mode === 'in-show' || settings.show_mode === 'rehearsal'
        ? settings.show_mode
        : 'rehearsal';
    res.json({ showMode, trackWasDurations: settings.track_was_durations === true });
  });

  app.patch('/api/show-mode/:eventId', (req, res) => {
    const { eventId } = req.params;
    const { showMode, trackWasDurations } = req.body || {};
    const row = db.prepare('SELECT settings FROM run_of_show_data WHERE event_id = ?').get(eventId);
    if (!row) return res.status(404).json({ error: 'Event not found' });
    const settings = parseJson(row.settings, {});
    if (showMode === 'rehearsal' || showMode === 'in-show') settings.show_mode = showMode;
    if (typeof trackWasDurations === 'boolean') settings.track_was_durations = trackWasDurations;
    const ts = nowIso();
    db.prepare('UPDATE run_of_show_data SET settings = ?, updated_at = ? WHERE event_id = ?').run(
      stringifyJson(settings),
      ts,
      eventId
    );
    const payload = {
      event_id: eventId,
      trackWasDurations: settings.track_was_durations === true,
    };
    if (showMode === 'rehearsal' || showMode === 'in-show') payload.showMode = settings.show_mode;
    broadcastUpdate(eventId, 'showModeUpdate', payload);
    res.json({
      showMode: settings.show_mode === 'in-show' ? 'in-show' : 'rehearsal',
      trackWasDurations: settings.track_was_durations === true,
    });
  });

  // ─── Run of show ──────────────────────────────────────────────────────────
  app.get('/api/run-of-show-data/:eventId', async (req, res) => {
    try {
      const row = db
        .prepare('SELECT * FROM run_of_show_data WHERE event_id = ?')
        .get(req.params.eventId);
      if (!row) return res.status(404).json({ error: 'Event not found' });
      res.json(normalizeRunOfShowRow(row));
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'Failed' });
    }
  });

  app.delete('/api/run-of-show-data/:eventId', async (req, res) => {
    const eventId = req.params.eventId;
    try {
      const r = db.prepare('DELETE FROM run_of_show_data WHERE event_id = ?').run(eventId);
      if (r.changes === 0) return res.status(404).json({ error: 'Run of show not found' });
      res.json({ message: 'Run of show deleted' });
    } catch (e) {
      res.status(500).json({
        error: e instanceof Error ? e.message : 'Failed to delete run of show',
      });
    }
  });

  app.post('/api/run-of-show-data', async (req, res) => {
    const body = req.body || {};
    const event_id = body.event_id;
    if (!event_id) return res.status(400).json({ error: 'event_id required' });

    const existing = db
      .prepare('SELECT settings FROM run_of_show_data WHERE event_id = ?')
      .get(event_id);
    let settingsToSave = body.settings || {};
    if (existing) {
      const current = parseJson(existing.settings, {});
      if (body.settings?.show_mode === undefined && current.show_mode) {
        settingsToSave = { ...settingsToSave, show_mode: current.show_mode };
      }
      if (body.settings?.track_was_durations === undefined && typeof current.track_was_durations === 'boolean') {
        settingsToSave = { ...settingsToSave, track_was_durations: current.track_was_durations };
      }
      if (body.settings?.original_durations === undefined && current.original_durations) {
        settingsToSave = { ...settingsToSave, original_durations: current.original_durations };
      }
    }

    const ts = nowIso();
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
      event_id,
      event_name: body.event_name,
      event_date: body.event_date,
      schedule_items: stringifyJson(body.schedule_items ?? []),
      custom_columns: stringifyJson(body.custom_columns ?? []),
      settings: stringifyJson(settingsToSave),
      last_modified_by: body.last_modified_by,
      last_modified_by_name: body.last_modified_by_name,
      last_modified_by_role: body.last_modified_by_role,
      last_change_at: ts,
      created_at: ts,
      updated_at: ts,
    });

    const saved = normalizeRunOfShowRow(
      db.prepare('SELECT * FROM run_of_show_data WHERE event_id = ?').get(event_id)
    );
    broadcastUpdate(event_id, 'runOfShowDataUpdated', saved);
    res.json(saved);
  });

  // ─── Active timers (one row per event) ────────────────────────────────────
  app.get('/api/active-timers/:eventId', (req, res) => {
    const rows = db
      .prepare('SELECT * FROM active_timers WHERE event_id = ? ORDER BY updated_at DESC LIMIT 1')
      .all(req.params.eventId);
    res.json(
      rows.map((row) => applyMediaSyncMeta(req.params.eventId, normalizeActiveTimer(row), { isSubCue: false }))
    );
  });

  app.post('/api/active-timers', (req, res) => {
    const b = req.body || {};
    const {
      event_id,
      item_id,
      user_id,
      timer_state,
      is_active,
      is_running,
      started_at,
      last_loaded_cue_id,
      cue_is,
      duration_seconds,
    } = b;
    const user_name = b.user_name || 'Unknown User';
    const user_role = b.user_role || 'OPERATOR';
    const ts = nowIso();
    let started_at_value = started_at;
    if (timer_state === 'running' && (!started_at || started_at === 'null')) {
      started_at_value = ts;
    } else if (timer_state !== 'running' && (!started_at || started_at === 'null')) {
      started_at_value = '2099-12-31T23:59:59.999Z';
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
        @duration_seconds, 0, @created_at, @updated_at
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
        updated_at = excluded.updated_at
    `).run({
      id,
      event_id,
      item_id,
      user_id,
      user_name,
      user_role,
      timer_state: timer_state || 'stopped',
      is_active: boolToInt(is_active),
      is_running: boolToInt(is_running),
      started_at: started_at_value,
      last_loaded_cue_id,
      cue_is,
      duration_seconds: duration_seconds ?? 300,
      created_at: ts,
      updated_at: ts,
    });
    const row = normalizeActiveTimer(
      db.prepare('SELECT * FROM active_timers WHERE event_id = ?').get(event_id)
    );
    broadcastUpdate(event_id, 'timerUpdated', row);
    res.status(201).json(row);
  });

  app.put('/api/active-timers/stop-all', (req, res) => {
    const { event_id } = req.body || {};
    const ts = nowIso();
    const result = db.prepare(`
      UPDATE active_timers SET is_running = 0, is_active = 0, timer_state = 'stopped', updated_at = ?
      WHERE event_id = ?
    `).run(ts, event_id);
    broadcastUpdate(event_id, 'timersStopped', { count: result.changes, event_id });
    res.json({ success: true, stoppedCount: result.changes });
  });

  app.put('/api/active-timers/stop', (req, res) => {
    const { event_id, item_id } = req.body || {};
    const ts = nowIso();
    db.prepare(`
      UPDATE active_timers SET is_running = 0, is_active = 0, timer_state = 'stopped', updated_at = ?
      WHERE event_id = ? AND (item_id = ? OR ? IS NULL)
    `).run(ts, event_id, item_id, item_id);
    const row = db.prepare('SELECT * FROM active_timers WHERE event_id = ?').get(event_id);
    if (row) {
      const normalized = normalizeActiveTimer(row);
      broadcastUpdate(event_id, 'timerStopped', normalized);
      broadcastUpdate(event_id, 'timerUpdated', normalized);
      return res.json(normalized);
    }
    res.json({});
  });

  app.post('/api/timers/reset', (req, res) => {
    const { event_id } = req.body || {};
    if (!event_id) {
      return res.status(400).json({ error: 'event_id required' });
    }
    db.prepare('DELETE FROM active_timers WHERE event_id = ?').run(event_id);
    try {
      db.prepare('DELETE FROM sub_cue_timers WHERE event_id = ?').run(event_id);
    } catch {
      // table may not exist in older DBs
    }
    try {
      db.prepare('DELETE FROM completed_cues WHERE event_id = ?').run(event_id);
    } catch {
      // table may not exist in older DBs
    }
    broadcastUpdate(event_id, 'resetAllStates', { event_id });
    broadcastUpdate(event_id, 'timersStopped', { event_id, count: 1 });
    res.json({ success: true, event_id });
  });

  // ─── Completed cues ─────────────────────────────────────────────────────────
  app.get('/api/completed-cues/:eventId', (req, res) => {
    const rows = db.prepare('SELECT * FROM completed_cues WHERE event_id = ?').all(req.params.eventId);
    res.json(rows);
  });

  app.post('/api/completed-cues', (req, res) => {
    const { event_id, item_id, user_id, cue_id, user_name, user_role } = req.body || {};
    if (!event_id || !item_id || !user_id) {
      return res.status(400).json({ error: 'event_id, item_id, user_id required' });
    }
    const ts = nowIso();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO completed_cues (id, event_id, item_id, cue_id, user_id, user_name, user_role, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      event_id,
      String(item_id),
      cue_id || `CUE ${item_id}`,
      user_id,
      user_name || 'Unknown User',
      user_role || 'VIEWER',
      ts,
      ts,
      ts
    );
    const row = db.prepare('SELECT * FROM completed_cues WHERE id = ?').get(id);
    broadcastUpdate(event_id, 'completedCuesUpdated', row);
    res.status(201).json(row);
  });

  app.delete('/api/completed-cues/:eventId', (req, res) => {
    const { eventId } = req.params;
    const r = db.prepare('DELETE FROM completed_cues WHERE event_id = ?').run(eventId);
    broadcastUpdate(eventId, 'completedCuesUpdated', { cleared: true, count: r.changes });
    res.status(204).send();
  });

  app.delete('/api/completed-cues', (req, res) => {
    const { event_id, item_id } = req.body || {};
    db.prepare('DELETE FROM completed_cues WHERE event_id = ? AND item_id = ?').run(
      event_id,
      String(item_id)
    );
    broadcastUpdate(event_id, 'completedCuesUpdated', { removed: true, item_id });
    res.status(204).send();
  });

  // ─── Overtime ───────────────────────────────────────────────────────────────
  app.get('/api/overtime-minutes/:eventId', (req, res) => {
    const rows = db.prepare('SELECT * FROM overtime_minutes WHERE event_id = ?').all(req.params.eventId);
    res.json(rows);
  });

  app.post('/api/overtime-minutes', (req, res) => {
    const { event_id, item_id, overtime_minutes } = req.body || {};
    if (!event_id || item_id == null || typeof overtime_minutes !== 'number') {
      return res.status(400).json({ error: 'event_id, item_id, overtime_minutes required' });
    }
    const ts = nowIso();
    db.prepare(`
      INSERT INTO overtime_minutes (event_id, item_id, overtime_minutes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(event_id, item_id) DO UPDATE SET overtime_minutes = excluded.overtime_minutes, updated_at = excluded.updated_at
    `).run(event_id, String(item_id), overtime_minutes, ts, ts);
    broadcastUpdate(event_id, 'overtimeUpdate', {
      event_id,
      item_id,
      overtimeMinutes: overtime_minutes,
    });
    res.json({ success: true, overtime_minutes, item_id });
  });

  app.delete('/api/overtime-minutes/:eventId', (req, res) => {
    db.prepare('DELETE FROM overtime_minutes WHERE event_id = ?').run(req.params.eventId);
    broadcastUpdate(req.params.eventId, 'overtimeReset', { event_id: req.params.eventId });
    res.status(204).send();
  });

  // ─── Show start overtime ────────────────────────────────────────────────────
  app.get('/api/show-start-overtime/:eventId', (req, res) => {
    const row = db.prepare('SELECT * FROM show_start_overtime WHERE event_id = ?').get(req.params.eventId);
    res.json(row || null);
  });

  app.post('/api/show-start-overtime', (req, res) => {
    const { event_id, item_id, show_start_overtime, scheduled_time, actual_time } = req.body || {};
    const ts = nowIso();
    db.prepare(`
      INSERT INTO show_start_overtime (event_id, item_id, show_start_overtime, scheduled_time, actual_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        item_id = excluded.item_id,
        show_start_overtime = excluded.show_start_overtime,
        scheduled_time = excluded.scheduled_time,
        actual_time = excluded.actual_time,
        updated_at = excluded.updated_at
    `).run(event_id, item_id, show_start_overtime ?? 0, scheduled_time, actual_time, ts, ts);
    broadcastUpdate(event_id, 'showStartOvertimeUpdate', {
      event_id,
      item_id,
      show_start_overtime,
      scheduled_time,
      actual_time,
    });
    res.json({ success: true });
  });

  app.delete('/api/show-start-overtime/:eventId', (req, res) => {
    db.prepare('DELETE FROM show_start_overtime WHERE event_id = ?').run(req.params.eventId);
    broadcastUpdate(req.params.eventId, 'showStartOvertimeReset', { event_id: req.params.eventId });
    res.status(204).send();
  });

  // ─── Timer messages ─────────────────────────────────────────────────────────
  app.get('/api/timer-messages/:eventId', (req, res) => {
    const rows = db
      .prepare('SELECT * FROM timer_messages WHERE event_id = ? ORDER BY created_at DESC')
      .all(req.params.eventId);
    res.json(rows.map(normalizeTimerMessage));
  });

  app.put('/api/timer-messages/:id', (req, res) => {
    const id = req.params.id;
    const { enabled, message } = req.body || {};
    const ts = nowIso();
    const row = db.prepare('SELECT * FROM timer_messages WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Message not found' });
    db.prepare(`
      UPDATE timer_messages SET
        enabled = COALESCE(?, enabled),
        message = COALESCE(?, message),
        updated_at = ?
      WHERE id = ?
    `).run(
      enabled != null ? boolToInt(enabled) : null,
      message ?? null,
      ts,
      id
    );
    const updated = normalizeTimerMessage(db.prepare('SELECT * FROM timer_messages WHERE id = ?').get(id));
    broadcastUpdate(updated.event_id, 'timerMessageUpdated', updated);
    res.json(updated);
  });

  app.post('/api/timer-messages', (req, res) => {
    const { event_id, message, enabled, sent_by, sent_by_name, sent_by_role } = req.body || {};
    if (!event_id || !message) {
      return res.status(400).json({ error: 'event_id and message required' });
    }
    db.prepare('UPDATE timer_messages SET enabled = 0 WHERE event_id = ? AND enabled = 1').run(event_id);
    const ts = nowIso();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO timer_messages (id, event_id, message, enabled, sent_by, sent_by_name, sent_by_role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      event_id,
      message,
      boolToInt(enabled !== false),
      sent_by,
      sent_by_name,
      sent_by_role,
      ts,
      ts
    );
    const row = normalizeTimerMessage(db.prepare('SELECT * FROM timer_messages WHERE id = ?').get(id));
    broadcastUpdate(event_id, 'timerMessageUpdated', row);
    res.json(row);
  });

  // ─── Indented cues ──────────────────────────────────────────────────────────
  app.get('/api/indented-cues/:eventId', (req, res) => {
    const rows = db.prepare('SELECT * FROM indented_cues WHERE event_id = ?').all(req.params.eventId);
    res.json(rows);
  });

  app.post('/api/indented-cues', (req, res) => {
    const { event_id, item_id, parent_item_id, user_id, user_name, user_role } = req.body || {};
    const ts = nowIso();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO indented_cues (id, event_id, item_id, parent_item_id, user_id, user_name, user_role, indented_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id, item_id) DO UPDATE SET
        parent_item_id = excluded.parent_item_id,
        updated_at = excluded.updated_at
    `).run(id, event_id, String(item_id), parent_item_id, user_id, user_name, user_role, ts, ts, ts);
    const row = db.prepare('SELECT * FROM indented_cues WHERE event_id = ? AND item_id = ?').get(
      event_id,
      String(item_id)
    );
    broadcastUpdate(event_id, 'indentedCuesUpdated', row);
    res.status(201).json(row);
  });

  app.delete('/api/indented-cues/:eventId', (req, res) => {
    const r = db.prepare('DELETE FROM indented_cues WHERE event_id = ?').run(req.params.eventId);
    broadcastUpdate(req.params.eventId, 'indentedCuesUpdated', { cleared: true, count: r.changes });
    res.status(204).send();
  });

  // ─── Sub-cue timers (one per event) ─────────────────────────────────────────
  function normalizeSubCue(row) {
    if (!row) return null;
    return {
      ...row,
      is_active: intToBool(row.is_active),
      is_running: intToBool(row.is_running),
    };
  }

  app.get('/api/sub-cue-timers/:eventId', (req, res) => {
    const rows = db
      .prepare('SELECT * FROM sub_cue_timers WHERE event_id = ? AND is_running = 1')
      .all(req.params.eventId);
    res.json(rows.map(normalizeSubCue));
  });

  app.post('/api/sub-cue-timers', (req, res) => {
    const b = req.body || {};
    const { event_id, item_id, user_id, duration_seconds, row_number, cue_display, timer_id } = b;
    const ts = nowIso();
    db.prepare(`
      INSERT INTO sub_cue_timers (
        event_id, item_id, user_id, user_name, user_role, duration_seconds,
        row_number, cue_display, timer_id, is_active, is_running, started_at, created_at, updated_at
      ) VALUES (
        @event_id, @item_id, @user_id, @user_name, @user_role, @duration_seconds,
        @row_number, @cue_display, @timer_id, 1, 1, @started_at, @created_at, @updated_at
      )
      ON CONFLICT(event_id) DO UPDATE SET
        item_id = excluded.item_id,
        user_id = excluded.user_id,
        user_name = excluded.user_name,
        user_role = excluded.user_role,
        duration_seconds = excluded.duration_seconds,
        row_number = excluded.row_number,
        cue_display = excluded.cue_display,
        timer_id = excluded.timer_id,
        is_active = 1,
        is_running = 1,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at
    `).run({
      event_id,
      item_id: String(item_id),
      user_id,
      user_name: b.user_name || 'Unknown User',
      user_role: b.user_role || 'OPERATOR',
      duration_seconds: duration_seconds ?? 0,
      row_number: row_number ?? null,
      cue_display: cue_display ?? null,
      timer_id: timer_id ?? null,
      started_at: b.started_at || ts,
      created_at: ts,
      updated_at: ts,
    });
    const row = normalizeSubCue(
      db.prepare('SELECT * FROM sub_cue_timers WHERE event_id = ?').get(event_id)
    );
    broadcastUpdate(event_id, 'subCueTimerStarted', row);
    res.status(201).json(row);
  });

  app.put('/api/sub-cue-timers/stop', (req, res) => {
    const { event_id, item_id } = req.body || {};
    const ts = nowIso();
    db.prepare(`
      UPDATE sub_cue_timers SET is_running = 0, is_active = 0, updated_at = ?
      WHERE event_id = ? AND (item_id = ? OR ? IS NULL)
    `).run(ts, event_id, item_id != null ? String(item_id) : null, item_id);
    const row = normalizeSubCue(
      db.prepare('SELECT * FROM sub_cue_timers WHERE event_id = ?').get(event_id)
    );
    if (row) {
      broadcastUpdate(event_id, 'subCueTimerStopped', row);
      return res.json(row);
    }
    res.json({});
  });

  // ─── Change log (offline: accept logs, return empty history) ────────────────
  app.get('/api/change-log/:eventId', (_req, res) => {
    res.json([]);
  });

  app.post('/api/change-log', (_req, res) => {
    res.status(201).json({ ok: true });
  });

  app.delete('/api/change-log/:eventId', (_req, res) => {
    res.status(204).send();
  });

  // ─── Start cue selection (stored in run_of_show settings) ───────────────────
  app.get('/api/start-cue-selection/:eventId', (req, res) => {
    const row = db
      .prepare('SELECT settings FROM run_of_show_data WHERE event_id = ?')
      .get(req.params.eventId);
    if (!row) return res.json(null);
    const settings = parseJson(row.settings, {});
    const itemId = settings.start_cue_item_id;
    res.json(itemId != null ? { itemId: Number(itemId) } : null);
  });

  app.post('/api/start-cue-selection', (req, res) => {
    const { event_id, item_id } = req.body || {};
    const row = db.prepare('SELECT settings FROM run_of_show_data WHERE event_id = ?').get(event_id);
    if (!row) return res.status(404).json({ error: 'Event not found' });
    const settings = parseJson(row.settings, {});
    settings.start_cue_item_id = item_id;
    const ts = nowIso();
    db.prepare('UPDATE run_of_show_data SET settings = ?, updated_at = ? WHERE event_id = ?').run(
      stringifyJson(settings),
      ts,
      event_id
    );
    broadcastUpdate(event_id, 'startCueSelectionUpdate', { event_id, item_id });
    res.json({ success: true, item_id });
  });

  // Dev helper — seed a sample event (LAN only)
  app.post('/api/dev/seed-sample', (_req, res) => {
    const eventId = randomUUID();
    const ts = nowIso();
    db.prepare(`
      INSERT INTO calendar_events (id, name, date, schedule_data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(eventId, 'Offline Sample Show', new Date().toISOString().slice(0, 10), '{}', ts, ts);
    db.prepare(`
      INSERT INTO run_of_show_data (
        event_id, event_name, event_date, schedule_items, custom_columns, settings,
        last_modified_by, last_modified_by_name, last_modified_by_role,
        last_change_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      'Offline Sample Show',
      new Date().toISOString().slice(0, 10),
      stringifyJson([
        {
          id: 1,
          day: 1,
          segmentName: 'Opening',
          programType: 'Video',
          durationHours: 0,
          durationMinutes: 5,
          durationSeconds: 0,
          customFields: { cue: '1' },
        },
      ]),
      '[]',
      stringifyJson({ show_mode: 'rehearsal', eventName: 'Offline Sample Show' }),
      'offline_seed',
      'Offline Seed',
      'EDITOR',
      ts,
      ts,
      ts
    );
    res.status(201).json({ eventId, message: 'Sample event created' });
  });
}

module.exports = { registerRoutes };
