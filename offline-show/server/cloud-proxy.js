'use strict';

const { getCloudMode } = require('./cloud-mode');
const { railwayFetch, RAILWAY_BASE_URL } = require('./railway-client');
const { upsertCalendarEvent, upsertRunOfShow, deleteCalendarEventLocal, deleteRunOfShowLocal, logicalEventId } = require('./sqlite-mirror');
const { nowIso, stringifyJson, boolToInt, parseJson } = require('./db');

const LOCAL_EXACT = new Set([
  '/api/connectivity-status',
  '/api/cloud-mode',
  '/api/cloud-mode/reconnect',
  '/api/sync-from-cloud',
  '/api/reconnect-push',
  '/api/lan-info',
]);

const LOCAL_PREFIXES = ['/api/dev/'];

function pathnameOf(req) {
  const raw = req.originalUrl || req.url || '';
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}

function isLocalOnlyApiRoute(pathname) {
  if (LOCAL_EXACT.has(pathname)) return true;
  return LOCAL_PREFIXES.some((p) => pathname.startsWith(p));
}

function isCloudConnected(db) {
  return getCloudMode(db).cloudConnected;
}

function mirrorToSqlite(db, method, pathname, body, data) {
  try {
    if (method === 'DELETE') {
      const calDel = pathname.match(/^\/api\/calendar-events\/([^/]+)$/);
      if (calDel) {
        const id = calDel[1];
        const local = db.prepare('SELECT schedule_data FROM calendar_events WHERE id = ?').get(id);
        if (local) {
          deleteRunOfShowLocal(db, logicalEventId({ id, schedule_data: local.schedule_data }));
        }
        deleteCalendarEventLocal(db, id);
        return;
      }
      const rosDel = pathname.match(/^\/api\/run-of-show-data\/([^/]+)$/);
      if (rosDel) {
        deleteRunOfShowLocal(db, rosDel[1]);
        return;
      }
      const ccDel = pathname.match(/^\/api\/completed-cues\/([^/]+)$/);
      if (ccDel) {
        db.prepare('DELETE FROM completed_cues WHERE event_id = ?').run(ccDel[1]);
        return;
      }
      const otDel = pathname.match(/^\/api\/overtime-minutes\/([^/]+)$/);
      if (otDel) {
        db.prepare('DELETE FROM overtime_minutes WHERE event_id = ?').run(otDel[1]);
        return;
      }
      const ssoDel = pathname.match(/^\/api\/show-start-overtime\/([^/]+)$/);
      if (ssoDel) {
        db.prepare('DELETE FROM show_start_overtime WHERE event_id = ?').run(ssoDel[1]);
        return;
      }
      const icDel = pathname.match(/^\/api\/indented-cues\/([^/]+)$/);
      if (icDel) {
        db.prepare('DELETE FROM indented_cues WHERE event_id = ?').run(icDel[1]);
        return;
      }
      if (method === 'DELETE' && pathname === '/api/completed-cues' && body?.event_id && body?.item_id) {
        db.prepare('DELETE FROM completed_cues WHERE event_id = ? AND item_id = ?').run(
          body.event_id,
          String(body.item_id)
        );
      }
      return;
    }

    if (pathname === '/api/calendar-events' && method === 'GET' && Array.isArray(data)) {
      const tx = db.transaction((rows) => {
        for (const row of rows) upsertCalendarEvent(db, row);
      });
      tx(data);
      return;
    }
    if (pathname.startsWith('/api/calendar-events/') && method === 'GET' && data?.id) {
      upsertCalendarEvent(db, data);
      return;
    }
    if (method === 'POST' && pathname === '/api/calendar-events' && data?.id) {
      upsertCalendarEvent(db, data);
      return;
    }
    if (method === 'PUT' && pathname.startsWith('/api/calendar-events/') && data?.id) {
      upsertCalendarEvent(db, data);
      return;
    }
    const rosGet = pathname.match(/^\/api\/run-of-show-data\/([^/]+)$/);
    if (rosGet && method === 'GET' && data?.event_id) {
      upsertRunOfShow(db, data);
      return;
    }
    if (method === 'POST' && pathname === '/api/run-of-show-data' && data?.event_id) {
      upsertRunOfShow(db, data);
      return;
    }

    const timerGet = pathname.match(/^\/api\/active-timers\/([^/]+)$/);
    if (timerGet && method === 'GET' && Array.isArray(data)) {
      const eventId = timerGet[1];
      db.prepare('DELETE FROM active_timers WHERE event_id = ?').run(eventId);
      for (const row of data) mirrorActiveTimer(db, row);
      return;
    }
    if (method === 'POST' && pathname === '/api/active-timers' && data?.event_id) {
      mirrorActiveTimer(db, data);
      return;
    }
    if (pathname.startsWith('/api/active-timers/') && data?.event_id) {
      mirrorActiveTimer(db, data);
    }

    const ccGet = pathname.match(/^\/api\/completed-cues\/([^/]+)$/);
    if (ccGet && method === 'GET' && Array.isArray(data)) {
      const eventId = ccGet[1];
      db.prepare('DELETE FROM completed_cues WHERE event_id = ?').run(eventId);
      for (const row of data) mirrorCompletedCue(db, row);
    }
    if (method === 'POST' && pathname === '/api/completed-cues' && data?.event_id) {
      mirrorCompletedCue(db, data);
    }

    const otGet = pathname.match(/^\/api\/overtime-minutes\/([^/]+)$/);
    if (otGet && method === 'GET' && Array.isArray(data)) {
      const eventId = otGet[1];
      db.prepare('DELETE FROM overtime_minutes WHERE event_id = ?').run(eventId);
      for (const row of data) mirrorOvertime(db, row);
    }
    if (method === 'POST' && pathname === '/api/overtime-minutes' && body?.event_id) {
      mirrorOvertime(db, {
        event_id: body.event_id,
        item_id: body.item_id,
        overtime_minutes: body.overtime_minutes,
      });
    }

    const ssoGet = pathname.match(/^\/api\/show-start-overtime\/([^/]+)$/);
    if (ssoGet && method === 'GET' && data?.event_id) {
      mirrorShowStartOvertime(db, data);
    }
    if (method === 'POST' && pathname === '/api/show-start-overtime' && body?.event_id) {
      mirrorShowStartOvertime(db, body);
    }

    const tmGet = pathname.match(/^\/api\/timer-messages\/([^/]+)$/);
    if (tmGet && method === 'GET' && Array.isArray(data)) {
      const eventId = tmGet[1];
      db.prepare('DELETE FROM timer_messages WHERE event_id = ?').run(eventId);
      for (const row of data) mirrorTimerMessage(db, row);
    }
    if ((method === 'POST' || method === 'PUT') && pathname.startsWith('/api/timer-messages') && data?.event_id) {
      mirrorTimerMessage(db, data);
    }

    const icGet = pathname.match(/^\/api\/indented-cues\/([^/]+)$/);
    if (icGet && method === 'GET' && Array.isArray(data)) {
      const eventId = icGet[1];
      db.prepare('DELETE FROM indented_cues WHERE event_id = ?').run(eventId);
      for (const row of data) mirrorIndentedCue(db, row);
    }
    if (method === 'POST' && pathname === '/api/indented-cues' && data?.event_id) {
      mirrorIndentedCue(db, data);
    }

    const subGet = pathname.match(/^\/api\/sub-cue-timers\/([^/]+)$/);
    if (subGet && method === 'GET' && data?.event_id) {
      mirrorSubCueTimer(db, data);
    }
    if (pathname.startsWith('/api/sub-cue-timers') && data?.event_id) {
      mirrorSubCueTimer(db, data);
    }

    const smPatch = pathname.match(/^\/api\/show-mode\/([^/]+)$/);
    if (smPatch && method === 'PATCH' && data?.showMode != null) {
      mirrorShowMode(db, smPatch[1], data);
    }
  } catch (e) {
    console.warn('⚠️ SQLite mirror after cloud proxy:', e.message);
  }
}

function mirrorActiveTimer(db, row) {
  if (!row?.event_id) return;
  const ts = row.updated_at || nowIso();
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
    id: row.id || `${row.event_id}-timer`,
    event_id: row.event_id,
    item_id: row.item_id,
    user_id: row.user_id,
    user_name: row.user_name,
    user_role: row.user_role,
    timer_state: row.timer_state || 'stopped',
    is_active: boolToInt(row.is_active),
    is_running: boolToInt(row.is_running),
    started_at: row.started_at,
    last_loaded_cue_id: row.last_loaded_cue_id,
    cue_is: row.cue_is,
    duration_seconds: row.duration_seconds ?? 300,
    elapsed_seconds: row.elapsed_seconds ?? 0,
    created_at: row.created_at || ts,
    updated_at: ts,
  });
}

function mirrorCompletedCue(db, row) {
  if (!row?.event_id || !row?.item_id) return;
  const ts = row.updated_at || row.completed_at || nowIso();
  db.prepare(`
    INSERT INTO completed_cues (id, event_id, item_id, cue_id, user_id, user_name, user_role, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(
    row.id || `${row.event_id}-${row.item_id}`,
    row.event_id,
    String(row.item_id),
    row.cue_id || `CUE ${row.item_id}`,
    row.user_id,
    row.user_name,
    row.user_role,
    row.completed_at || ts,
    row.created_at || ts,
    ts
  );
}

function mirrorOvertime(db, row) {
  if (!row?.event_id || row.item_id == null) return;
  const ts = row.updated_at || nowIso();
  db.prepare(`
    INSERT INTO overtime_minutes (event_id, item_id, overtime_minutes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(event_id, item_id) DO UPDATE SET overtime_minutes = excluded.overtime_minutes, updated_at = excluded.updated_at
  `).run(row.event_id, String(row.item_id), row.overtime_minutes ?? 0, ts, ts);
}

function mirrorShowStartOvertime(db, row) {
  if (!row?.event_id) return;
  const ts = row.updated_at || nowIso();
  db.prepare(`
    INSERT INTO show_start_overtime (event_id, item_id, show_start_overtime, scheduled_time, actual_time, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      item_id = excluded.item_id,
      show_start_overtime = excluded.show_start_overtime,
      scheduled_time = excluded.scheduled_time,
      actual_time = excluded.actual_time,
      updated_at = excluded.updated_at
  `).run(
    row.event_id,
    row.item_id,
    row.show_start_overtime ?? 0,
    row.scheduled_time,
    row.actual_time,
    ts,
    ts
  );
}

function mirrorTimerMessage(db, row) {
  if (!row?.event_id || !row?.id) return;
  const ts = row.updated_at || row.created_at || nowIso();
  db.prepare(`
    INSERT INTO timer_messages (id, event_id, message, enabled, sent_by, sent_by_name, sent_by_role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      message = excluded.message,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(
    row.id,
    row.event_id,
    row.message,
    boolToInt(row.enabled),
    row.sent_by,
    row.sent_by_name,
    row.sent_by_role,
    row.created_at || ts,
    ts
  );
}

function mirrorIndentedCue(db, row) {
  if (!row?.event_id || row.item_id == null) return;
  const ts = row.updated_at || row.indented_at || nowIso();
  db.prepare(`
    INSERT INTO indented_cues (id, event_id, item_id, parent_item_id, user_id, user_name, user_role, indented_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id, item_id) DO UPDATE SET parent_item_id = excluded.parent_item_id, updated_at = excluded.updated_at
  `).run(
    row.id || `${row.event_id}-${row.item_id}`,
    row.event_id,
    String(row.item_id),
    row.parent_item_id,
    row.user_id,
    row.user_name,
    row.user_role,
    row.indented_at || ts,
    row.created_at || ts,
    ts
  );
}

function mirrorSubCueTimer(db, row) {
  if (!row?.event_id) return;
  const ts = row.updated_at || nowIso();
  db.prepare(`
    INSERT INTO sub_cue_timers (
      id, event_id, item_id, user_id, user_name, user_role, timer_state,
      is_active, is_running, started_at, duration_seconds, created_at, updated_at
    ) VALUES (
      @id, @event_id, @item_id, @user_id, @user_name, @user_role, @timer_state,
      @is_active, @is_running, @started_at, @duration_seconds, @created_at, @updated_at
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
      duration_seconds = excluded.duration_seconds,
      updated_at = excluded.updated_at
  `).run({
    id: row.id || `${row.event_id}-sub`,
    event_id: row.event_id,
    item_id: row.item_id,
    user_id: row.user_id,
    user_name: row.user_name,
    user_role: row.user_role,
    timer_state: row.timer_state || 'stopped',
    is_active: boolToInt(row.is_active),
    is_running: boolToInt(row.is_running),
    started_at: row.started_at,
    duration_seconds: row.duration_seconds ?? 60,
    created_at: row.created_at || ts,
    updated_at: ts,
  });
}

function mirrorShowMode(db, eventId, data) {
  const row = db.prepare('SELECT settings FROM run_of_show_data WHERE event_id = ?').get(eventId);
  if (!row) return;
  const settings = parseJson(row.settings, {});
  if (data.showMode === 'rehearsal' || data.showMode === 'in-show') settings.show_mode = data.showMode;
  if (typeof data.trackWasDurations === 'boolean') settings.track_was_durations = data.trackWasDurations;
  db.prepare('UPDATE run_of_show_data SET settings = ?, updated_at = ? WHERE event_id = ?').run(
    stringifyJson(settings),
    nowIso(),
    eventId
  );
}

async function proxyToRailway(req, res, db, broadcastUpdate) {
  const pathname = pathnameOf(req);
  const query = (req.originalUrl || req.url || '').includes('?')
    ? (req.originalUrl || req.url || '').slice((req.originalUrl || req.url || '').indexOf('?'))
    : '';
  const pathWithQuery = `${pathname}${query}`;

  console.log(`☁️ → Railway ${req.method} ${pathWithQuery}`);

  const result = await railwayFetch(req.method, pathWithQuery, req.body);
  mirrorToSqlite(db, req.method, pathname, req.body, result.data);
  // Fan out to LAN clients immediately (operator + iPads) — don't wait only on Railway→bridge round-trip
  broadcastLanFromProxy(broadcastUpdate, req.method, pathname, req.body, result.data);

  if (result.noContent) {
    return res.status(result.status === 200 ? 204 : result.status).send();
  }
  return res.status(result.status).json(result.data);
}

function eventIdFromMutation(pathname, body, data) {
  if (body?.event_id) return String(body.event_id);
  if (data?.event_id) return String(data.event_id);
  if (data?.eventId) return String(data.eventId);
  const m = pathname.match(
    /\/api\/(?:run-of-show-data|active-timers|completed-cues|overtime-minutes|show-start-overtime|timer-messages|indented-cues|sub-cue-timers|show-mode)\/([^/]+)/
  );
  return m ? m[1] : null;
}

function broadcastLanFromProxy(broadcastUpdate, method, pathname, body, data) {
  if (!broadcastUpdate || method === 'GET' || method === 'HEAD') return;
  const eventId = eventIdFromMutation(pathname, body, data);
  if (!eventId) return;

  if (pathname.includes('run-of-show-data')) {
    broadcastUpdate(eventId, 'runOfShowDataUpdated', data);
  } else if (pathname.includes('active-timers')) {
    if (pathname.endsWith('/stop-all')) {
      broadcastUpdate(eventId, 'timersStopped', data || { event_id: eventId });
    } else if (pathname.endsWith('/stop')) {
      broadcastUpdate(eventId, 'timerStopped', data);
      broadcastUpdate(eventId, 'timerUpdated', data);
    } else {
      broadcastUpdate(eventId, 'timerUpdated', data);
    }
  } else if (pathname.includes('completed-cues')) {
    broadcastUpdate(eventId, 'completedCuesUpdated', data);
  } else if (pathname.includes('overtime-minutes')) {
    broadcastUpdate(eventId, 'overtimeUpdate', data);
  } else if (pathname.includes('show-start-overtime')) {
    broadcastUpdate(eventId, 'showStartOvertimeUpdate', data);
  } else if (pathname.includes('timer-messages')) {
    broadcastUpdate(eventId, 'timerMessageUpdated', data);
  } else if (pathname.includes('indented-cues')) {
    broadcastUpdate(eventId, 'indentedCuesUpdated', data);
  } else if (pathname.includes('sub-cue-timers')) {
    broadcastUpdate(eventId, 'subCueTimerStarted', data);
  } else if (pathname.includes('show-mode')) {
    broadcastUpdate(eventId, 'showModeUpdate', data);
  }
}

/** When Cloud on, forward /api/* to Railway/Neon (same as main app). LAN only uses routes below. */
function installCloudProxy(app, db, broadcastUpdate) {
  app.use(async (req, res, next) => {
    const pathname = pathnameOf(req);
    if (!pathname.startsWith('/api')) return next();
    if (isLocalOnlyApiRoute(pathname)) return next();
    if (!isCloudConnected(db)) return next();

    try {
      await proxyToRailway(req, res, db, broadcastUpdate);
    } catch (e) {
      console.error(`☁️ Railway proxy failed ${req.method} ${pathname}:`, e.message);
      res.status(e.status && e.status >= 400 ? e.status : 502).json({
        error: e instanceof Error ? e.message : 'Railway request failed',
        source: RAILWAY_BASE_URL,
        cloudMode: 'cloud-connected',
      });
    }
  });
}

module.exports = {
  installCloudProxy,
  isCloudConnected,
  isLocalOnlyApiRoute,
  mirrorToSqlite,
};
