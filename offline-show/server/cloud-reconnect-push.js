'use strict';

const { railwayRequest, RAILWAY_BASE_URL } = require('./railway-client');
const { upsertRunOfShow, upsertActiveTimer } = require('./sqlite-mirror');
const { normalizeActiveTimer } = require('./db');
const { probeRailwayReachable } = require('./connectivity');

async function fetchCloudArray(path) {
  try {
    const data = await railwayRequest('GET', path);
    if (data == null) return [];
    return Array.isArray(data) ? data : [data];
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

function asBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function timerIsLive(t) {
  if (!t || t.item_id == null || t.item_id === '') return false;
  return (
    t.timer_state === 'running' ||
    t.timer_state === 'loaded' ||
    asBool(t.is_running) ||
    asBool(t.is_active)
  );
}

function toItemId(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'string' ? parseInt(v, 10) : Number(v);
  return Number.isNaN(n) ? null : n;
}

function elapsedSecondsFromStartedAt(startedAt) {
  if (!startedAt || startedAt === 'null') return 0;
  const startMs = new Date(startedAt).getTime();
  if (Number.isNaN(startMs)) return 0;
  return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
}

function readLocalActiveTimer(db, eventId) {
  const row = db
    .prepare('SELECT * FROM active_timers WHERE event_id = ? ORDER BY updated_at DESC LIMIT 1')
    .get(eventId);
  return row ? normalizeActiveTimer(row) : null;
}

/** Pick the live timer: UI/client hint first, then local SQLite; never use a stopped DB row over UI. */
function resolveActiveTimerForPush(db, eventId, clientTimer) {
  const local = readLocalActiveTimer(db, eventId);
  const client =
    clientTimer?.item_id != null
      ? normalizeActiveTimer({ ...clientTimer, event_id: eventId })
      : null;

  const localLive = timerIsLive(local);
  const clientLive = timerIsLive(client);

  if (!localLive && !clientLive) return null;

  let picked;
  if (clientLive && localLive) {
    const clientRunning = asBool(client.is_running) || client.timer_state === 'running';
    const localRunning = asBool(local.is_running) || local.timer_state === 'running';
    if (clientRunning && !localRunning) picked = { ...local, ...client };
    else if (localRunning && !clientRunning) picked = { ...client, ...local };
    else picked = { ...local, ...client };
  } else {
    picked = clientLive ? client : local;
  }

  const isRunning = asBool(picked.is_running) || picked.timer_state === 'running';
  const isActive =
    isRunning || asBool(picked.is_active) || picked.timer_state === 'loaded';
  const timerState = isRunning ? 'running' : 'loaded';
  const itemId = toItemId(picked.item_id);
  if (itemId == null) return null;

  const startedAt = picked.started_at;
  const useServerTime = isRunning && (!startedAt || startedAt === 'null');

  return {
    event_id: eventId,
    item_id: itemId,
    user_id: picked.user_id,
    user_name: picked.user_name || 'Unknown User',
    user_role: picked.user_role || 'OPERATOR',
    timer_state: timerState,
    is_active: true,
    is_running: isRunning,
    started_at: useServerTime ? null : startedAt,
    last_loaded_cue_id: toItemId(picked.last_loaded_cue_id) ?? itemId,
    cue_is: picked.cue_is || null,
    duration_seconds: picked.duration_seconds ?? 300,
    useServerTime,
  };
}

async function pushActiveTimerToRailway(db, eventId, clientTimer) {
  const resolved = resolveActiveTimerForPush(db, eventId, clientTimer);
  if (!resolved) {
    return { pushed: false, reason: 'no-live-timer' };
  }

  const payload = {
    event_id: eventId,
    item_id: resolved.item_id,
    user_id: resolved.user_id,
    user_name: resolved.user_name,
    user_role: resolved.user_role,
    timer_state: resolved.timer_state,
    is_active: true,
    is_running: resolved.is_running,
    started_at: resolved.started_at,
    last_loaded_cue_id: resolved.last_loaded_cue_id,
    cue_is: resolved.cue_is,
    duration_seconds: resolved.duration_seconds,
  };

  console.log('☁️↑ Reconnect active timer push:', {
    item_id: payload.item_id,
    timer_state: payload.timer_state,
    is_running: payload.is_running,
    started_at: payload.started_at,
    cue_is: payload.cue_is,
  });

  const saved = await railwayRequest('POST', '/api/active-timers', payload);
  upsertActiveTimer(db, {
    ...payload,
    elapsed_seconds:
      resolved.is_running && !resolved.useServerTime
        ? elapsedSecondsFromStartedAt(resolved.started_at)
        : 0,
  });

  return {
    pushed: true,
    itemId: payload.item_id,
    timerState: payload.timer_state,
    railwayItemId: saved?.item_id ?? payload.item_id,
    railwayTimerState: saved?.timer_state ?? payload.timer_state,
  };
}

/**
 * Push offline show snapshot to Railway while still on LAN (before cloud proxy).
 * Never bulk-deletes cloud data — upserts schedule and adds missing live state.
 */
async function pushReconnectSnapshotToRailway(db, body) {
  await probeRailwayReachable();

  const eventId = body?.event_id;
  if (!eventId) throw new Error('event_id is required');

  const stats = {
    direction: 'push-before-connect',
    source: RAILWAY_BASE_URL,
    event_id: eventId,
    scheduleItems: 0,
    activeTimer: false,
    activeTimerItemId: null,
    activeTimerState: null,
    activeTimerSource: null,
    completedCuesAdded: 0,
    indentedCuesAdded: 0,
    subCueTimer: false,
  };

  const ros = body.run_of_show;
  const items = ros?.schedule_items;

  // Push live cue/timer BEFORE schedule so hosted clients get the correct loaded/running row.
  const timerResult = await pushActiveTimerToRailway(db, eventId, body.active_timer);
  stats.activeTimer = timerResult.pushed === true;
  stats.activeTimerItemId = timerResult.itemId ?? null;
  stats.activeTimerState = timerResult.timerState ?? null;
  stats.activeTimerSource = timerResult.pushed ? 'push' : timerResult.reason ?? 'skipped';

  if (ros && Array.isArray(items) && items.length > 0) {
    await railwayRequest('POST', '/api/run-of-show-data', ros);
    upsertRunOfShow(db, ros);
    stats.scheduleItems = items.length;
  } else {
    throw new Error('Cannot reconnect — schedule has no items to upload');
  }

  // Re-assert timer after schedule save (schedule POST must not leave cloud on wrong cue).
  if (timerResult.pushed) {
    const again = await pushActiveTimerToRailway(db, eventId, body.active_timer);
    if (again.pushed) {
      stats.activeTimerItemId = again.itemId;
      stats.activeTimerState = again.timerState;
    }
  }

  const cloudCompleted = await fetchCloudArray(`/api/completed-cues/${encodeURIComponent(eventId)}`);
  const cloudCompletedKeys = new Set(
    cloudCompleted.map((r) => `${r.item_id}:${r.user_id}`)
  );
  const completed = Array.isArray(body.completed_cues) ? body.completed_cues : [];
  for (const cue of completed) {
    const key = `${cue.item_id}:${cue.user_id}`;
    if (cloudCompletedKeys.has(key)) continue;
    await railwayRequest('POST', '/api/completed-cues', {
      event_id: eventId,
      item_id: cue.item_id,
      cue_id: cue.cue_id || `CUE ${cue.item_id}`,
      user_id: cue.user_id,
      user_name: cue.user_name,
      user_role: cue.user_role,
    });
    stats.completedCuesAdded += 1;
  }

  const cloudIndented = await fetchCloudArray(`/api/indented-cues/${encodeURIComponent(eventId)}`);
  const cloudIndentedKeys = new Set(cloudIndented.map((r) => String(r.item_id)));
  const indented = Array.isArray(body.indented_cues) ? body.indented_cues : [];
  for (const row of indented) {
    if (!row.parent_item_id || cloudIndentedKeys.has(String(row.item_id))) continue;
    await railwayRequest('POST', '/api/indented-cues', {
      event_id: eventId,
      item_id: row.item_id,
      parent_item_id: row.parent_item_id,
      user_id: row.user_id,
      user_name: row.user_name,
      user_role: row.user_role,
    });
    stats.indentedCuesAdded += 1;
  }

  const subCue = body.sub_cue_timer;
  if (subCue?.item_id != null && (subCue.is_active || subCue.is_running)) {
    await railwayRequest('POST', '/api/sub-cue-timers', {
      event_id: eventId,
      item_id: subCue.item_id,
      user_id: subCue.user_id,
      user_name: subCue.user_name,
      user_role: subCue.user_role,
      duration_seconds: subCue.duration_seconds ?? 0,
      row_number: subCue.row_number,
      cue_display: subCue.cue_display,
      timer_id: subCue.timer_id,
      is_active: subCue.is_active === true || subCue.is_active === 1,
      is_running: subCue.is_running === true || subCue.is_running === 1,
      started_at: subCue.started_at,
    });
    stats.subCueTimer = true;
  }

  if (ros.settings?.show_mode) {
    try {
      await railwayRequest('PATCH', `/api/show-mode/${encodeURIComponent(eventId)}`, {
        showMode: ros.settings.show_mode,
        trackWasDurations: ros.settings.track_was_durations === true,
      });
    } catch (e) {
      console.warn('⚠️ reconnect show-mode patch:', e.message);
    }
  }

  console.log(
    `☁️↑ Reconnect push: ${stats.scheduleItems} schedule items, timer=${stats.activeTimer}` +
      (stats.activeTimer ? ` (item ${stats.activeTimerItemId}, ${stats.activeTimerState})` : '') +
      `, +${stats.completedCuesAdded} cues`
  );
  return stats;
}

module.exports = { pushReconnectSnapshotToRailway };
