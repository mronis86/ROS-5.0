'use strict';

/**
 * Resolume + Mitti companion sync for offline LAN mode.
 * Mirrors api-server.js mitti and resolume timer routes (in-memory armed/synced meta + one-shot align).
 * When cloud is connected, cloud-proxy forwards these to Railway instead.
 */

const { nowIso, randomUUID, boolToInt } = require('./db');

const resolumeTimeSourceByEvent = new Map();
const resolumePendingByEvent = new Map();
const mittiTimeSourceByEvent = new Map();
const mittiPendingByEvent = new Map();

function applyResolumeMeta(eventId, timerRow, options = {}) {
  if (!timerRow || typeof timerRow !== 'object') return timerRow;
  const wantsSubCue = options.isSubCue === true;
  const rowItemId = timerRow.item_id != null ? String(timerRow.item_id) : '';

  const synced = resolumeTimeSourceByEvent.get(eventId);
  if (synced?.time_source === 'resolume') {
    if (!!synced.is_sub_cue !== wantsSubCue) {
      return { ...timerRow, time_source: 'schedule', resolume_state: 'none' };
    }
    if (String(synced.item_id) !== rowItemId) {
      return { ...timerRow, time_source: 'schedule', resolume_state: 'none' };
    }
    return {
      ...timerRow,
      time_source: 'resolume',
      resolume_state: 'synced',
      resolume_align_seq: synced.align_seq ?? 0,
      resolume_align_reason: synced.align_reason ?? null,
    };
  }

  const pending = resolumePendingByEvent.get(eventId);
  if (pending) {
    if (!!pending.is_sub_cue !== wantsSubCue) {
      return { ...timerRow, time_source: 'schedule', resolume_state: 'none' };
    }
    if (rowItemId === String(pending.item_id)) {
      return { ...timerRow, time_source: 'resolume', resolume_state: 'armed' };
    }
  }
  return { ...timerRow, time_source: timerRow.time_source || 'schedule', resolume_state: 'none' };
}

function applyMittiMeta(eventId, timerRow, options = {}) {
  if (!timerRow || typeof timerRow !== 'object') return timerRow;
  const wantsSubCue = options.isSubCue === true;
  const rowItemId = timerRow.item_id != null ? String(timerRow.item_id) : '';

  const synced = mittiTimeSourceByEvent.get(eventId);
  if (synced?.time_source === 'mitti') {
    if (!!synced.is_sub_cue !== wantsSubCue) {
      return { ...timerRow, mitti_state: 'none' };
    }
    if (String(synced.item_id) !== rowItemId) {
      return { ...timerRow, mitti_state: 'none' };
    }
    return {
      ...timerRow,
      time_source: 'mitti',
      mitti_state: 'synced',
      mitti_align_seq: synced.align_seq ?? 0,
      mitti_align_reason: synced.align_reason ?? null,
    };
  }

  const pending = mittiPendingByEvent.get(eventId);
  if (pending) {
    if (!!pending.is_sub_cue !== wantsSubCue) {
      return { ...timerRow, mitti_state: 'none' };
    }
    if (rowItemId === String(pending.item_id)) {
      return { ...timerRow, time_source: 'mitti', mitti_state: 'armed' };
    }
  }
  return { ...timerRow, mitti_state: 'none' };
}

function applyMediaSyncMeta(eventId, timerRow, options = {}) {
  let data = applyResolumeMeta(eventId, timerRow, options);
  data = applyMittiMeta(eventId, data, options);
  return data;
}

function clearResolume(eventId) {
  resolumeTimeSourceByEvent.delete(eventId);
  resolumePendingByEvent.delete(eventId);
}

function clearMitti(eventId) {
  mittiTimeSourceByEvent.delete(eventId);
  mittiPendingByEvent.delete(eventId);
}

function wrapBroadcast(broadcastUpdate) {
  return function broadcastUpdateWithMeta(eventId, updateType, data) {
    let payload = data;
    if (updateType === 'timerUpdated' && data) {
      payload = applyMediaSyncMeta(eventId, data, { isSubCue: false });
    } else if (updateType === 'subCueTimerStarted' && data) {
      payload = applyMediaSyncMeta(eventId, data, { isSubCue: true });
    }
    return broadcastUpdate(eventId, updateType, payload);
  };
}

function registerMediaSyncRoutes(app, db, helpers) {
  const { broadcastUpdate, normalizeActiveTimer } = helpers;
  const emit = wrapBroadcast(broadcastUpdate);

  function normalizeSubCue(row) {
    if (!row) return null;
    return {
      ...row,
      is_active: row.is_active === 1 || row.is_active === true,
      is_running: row.is_running === 1 || row.is_running === true,
    };
  }

  function getMainTimer(eventId) {
    const row = db.prepare('SELECT * FROM active_timers WHERE event_id = ?').get(eventId);
    return row ? normalizeActiveTimer(row) : null;
  }

  function getSubTimer(eventId) {
    const row = db
      .prepare('SELECT * FROM sub_cue_timers WHERE event_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(eventId);
    return row ? normalizeSubCue(row) : null;
  }

  function upsertRunningMainTimer({
    eventId,
    itemId,
    userId,
    userName,
    cueIs,
    durationSeconds,
    startedAt,
  }) {
    const ts = nowIso();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO active_timers (
        id, event_id, item_id, user_id, user_name, user_role, timer_state,
        is_active, is_running, started_at, last_loaded_cue_id, cue_is,
        duration_seconds, elapsed_seconds, created_at, updated_at
      ) VALUES (
        @id, @event_id, @item_id, @user_id, @user_name, @user_role, 'running',
        1, 1, @started_at, @item_id, @cue_is,
        @duration_seconds, 0, @created_at, @updated_at
      )
      ON CONFLICT(event_id) DO UPDATE SET
        item_id = excluded.item_id,
        user_id = excluded.user_id,
        user_name = excluded.user_name,
        user_role = excluded.user_role,
        timer_state = 'running',
        is_active = 1,
        is_running = 1,
        started_at = excluded.started_at,
        last_loaded_cue_id = excluded.item_id,
        cue_is = COALESCE(excluded.cue_is, active_timers.cue_is),
        duration_seconds = excluded.duration_seconds,
        elapsed_seconds = 0,
        updated_at = excluded.updated_at
    `).run({
      id,
      event_id: eventId,
      item_id: itemId,
      user_id: userId,
      user_name: userName,
      user_role: 'OPERATOR',
      started_at: startedAt,
      cue_is: cueIs,
      duration_seconds: durationSeconds,
      created_at: ts,
      updated_at: ts,
    });
    return getMainTimer(eventId);
  }

  function upsertRunningSubTimer({
    eventId,
    itemId,
    userId,
    userName,
    cueIs,
    durationSeconds,
    startedAt,
    rowNumber,
  }) {
    const ts = nowIso();
    db.prepare(`
      INSERT INTO sub_cue_timers (
        event_id, item_id, user_id, user_name, user_role, duration_seconds,
        row_number, cue_display, timer_id, is_active, is_running, started_at, created_at, updated_at
      ) VALUES (
        @event_id, @item_id, @user_id, @user_name, @user_role, @duration_seconds,
        @row_number, @cue_display, NULL, 1, 1, @started_at, @created_at, @updated_at
      )
      ON CONFLICT(event_id) DO UPDATE SET
        item_id = excluded.item_id,
        user_id = excluded.user_id,
        user_name = excluded.user_name,
        user_role = excluded.user_role,
        duration_seconds = excluded.duration_seconds,
        row_number = excluded.row_number,
        cue_display = excluded.cue_display,
        is_active = 1,
        is_running = 1,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at
    `).run({
      event_id: eventId,
      item_id: String(itemId),
      user_id: userId,
      user_name: userName,
      user_role: 'OPERATOR',
      duration_seconds: durationSeconds,
      row_number: rowNumber ?? 0,
      cue_display: cueIs,
      started_at: startedAt,
      created_at: ts,
      updated_at: ts,
    });
    return getSubTimer(eventId);
  }

  function clampAlignRemaining(eventId, isSubCue, dur, rem) {
    const table = isSubCue ? 'sub_cue_timers' : 'active_timers';
    const existing = db.prepare(`SELECT started_at, duration_seconds, is_running FROM ${table} WHERE event_id = ? LIMIT 1`).get(eventId);
    if (!existing || !(existing.is_running === 1 || existing.is_running === true) || !existing.started_at) {
      return rem;
    }
    const existingDur = Number(existing.duration_seconds) || dur;
    const startedMs = new Date(existing.started_at).getTime();
    if (!Number.isFinite(startedMs) || startedMs >= Date.now() + 86400000) return rem;
    const existingRem = existingDur - (Date.now() - startedMs) / 1000;
    if (existingRem <= 15 && rem > existingDur * 0.85) {
      return Math.max(0, Math.min(rem, Math.max(0, existingRem)));
    }
    return rem;
  }

  function registerSourceRoutes(source) {
    const isMitti = source === 'mitti';
    const prefix = isMitti ? 'mitti' : 'resolume';
    const pendingMap = isMitti ? mittiPendingByEvent : resolumePendingByEvent;
    const syncedMap = isMitti ? mittiTimeSourceByEvent : resolumeTimeSourceByEvent;
    const clearAll = isMitti ? clearMitti : clearResolume;
    const clearPending = (eventId) => pendingMap.delete(eventId);
    const clearTimeSource = (eventId) => syncedMap.delete(eventId);
    const userIdDefault = isMitti ? 'companion-mitti' : 'companion-resolume';
    const userNameDefault = isMitti ? 'Mitti Sync' : 'Resolume Sync';
    const stateKey = isMitti ? 'mitti_state' : 'resolume_state';
    const seqKey = isMitti ? 'mitti_align_seq' : 'resolume_align_seq';
    const reasonKey = isMitti ? 'mitti_align_reason' : 'resolume_align_reason';
    const timeSource = isMitti ? 'mitti' : 'resolume';
    const emoji = isMitti ? '🎬' : '🎬';

    app.post(`/api/timers/${prefix}-arm`, (req, res) => {
      try {
        const { event_id, item_id, is_sub_cue } = req.body || {};
        if (!event_id || item_id == null) {
          return res.status(400).json({ error: 'event_id and item_id are required' });
        }
        const isSubCue = !!is_sub_cue;
        clearTimeSource(event_id);
        pendingMap.set(event_id, { item_id: parseInt(item_id, 10), is_sub_cue: isSubCue });
        if (isSubCue) {
          const sub = getSubTimer(event_id);
          if (sub) emit(event_id, 'subCueTimerStarted', sub);
        } else {
          const main = getMainTimer(event_id);
          if (main) emit(event_id, 'timerUpdated', main);
        }
        res.json({
          success: true,
          event_id,
          item_id: parseInt(item_id, 10),
          is_sub_cue: isSubCue,
          [stateKey]: 'armed',
        });
      } catch (e) {
        console.error(`Error in ${prefix}-arm:`, e);
        res.status(500).json({ error: `Failed to ${prefix}-arm`, details: e.message });
      }
    });

    app.post(`/api/timers/${prefix}-disarm`, (req, res) => {
      try {
        const { event_id } = req.body || {};
        if (!event_id) return res.status(400).json({ error: 'event_id is required' });
        clearAll(event_id);
        const main = getMainTimer(event_id);
        if (main) emit(event_id, 'timerUpdated', main);
        res.json({ success: true, event_id });
      } catch (e) {
        console.error(`Error in ${prefix}-disarm:`, e);
        res.status(500).json({ error: `Failed to ${prefix}-disarm`, details: e.message });
      }
    });

    app.post(`/api/timers/${prefix}-sync-align`, (req, res) => {
      try {
        const {
          event_id,
          item_id,
          duration_seconds,
          remaining_seconds,
          cue_is,
          user_id,
          align_at,
          latency_compensation_ms,
          align_reason,
          is_sub_cue,
          row_number,
        } = req.body || {};
        if (!event_id || item_id == null) {
          return res.status(400).json({ error: 'event_id and item_id are required' });
        }
        if (remaining_seconds == null || remaining_seconds === '') {
          return res.status(400).json({ error: 'remaining_seconds is required' });
        }

        const isSubCue = !!is_sub_cue;
        const dur = Math.max(1, Math.floor(Number(duration_seconds) || 300));
        let rem = Math.max(0, Math.min(dur, Number(remaining_seconds)));
        rem = clampAlignRemaining(event_id, isSubCue, dur, rem);

        const elapsed = dur - rem;
        const alignMs = align_at ? new Date(align_at).getTime() : Date.now();
        const compensationMs = Math.max(0, Math.min(15000, parseInt(latency_compensation_ms, 10) || 0));
        const startedAt = new Date(
          (Number.isFinite(alignMs) ? alignMs : Date.now()) - elapsed * 1000 - compensationMs
        ).toISOString();

        clearPending(event_id);
        const prevSynced = syncedMap.get(event_id);
        const alignSeq = (prevSynced?.align_seq || 0) + 1;
        const reason =
          typeof align_reason === 'string' && align_reason.trim() ? align_reason.trim() : 'align';
        syncedMap.set(event_id, {
          time_source: timeSource,
          item_id: parseInt(item_id, 10),
          align_seq: alignSeq,
          align_reason: reason,
          is_sub_cue: isSubCue,
        });

        console.log(
          `${emoji} Offline ${prefix} sync-align #${alignSeq} (${reason})${isSubCue ? ' [sub-cue]' : ''} - Event: ${event_id}, Item: ${item_id}, dur: ${dur}s, rem: ${rem}s`
        );

        let broadcastData;
        if (isSubCue) {
          broadcastData = upsertRunningSubTimer({
            eventId: event_id,
            itemId: parseInt(item_id, 10),
            userId: user_id || userIdDefault,
            userName: userNameDefault,
            cueIs: cue_is || `CUE ${item_id}`,
            durationSeconds: dur,
            startedAt,
            rowNumber: Number.isFinite(Number(row_number)) ? parseInt(row_number, 10) : 0,
          });
          emit(event_id, 'subCueTimerStarted', broadcastData);
          const main = getMainTimer(event_id);
          if (main) emit(event_id, 'timerUpdated', main);
        } else {
          broadcastData = upsertRunningMainTimer({
            eventId: event_id,
            itemId: parseInt(item_id, 10),
            userId: user_id || userIdDefault,
            userName: userNameDefault,
            cueIs: cue_is || `CUE ${item_id}`,
            durationSeconds: dur,
            startedAt,
          });
          emit(event_id, 'timerUpdated', broadcastData);
        }

        res.json({
          success: true,
          message: isSubCue ? `${userNameDefault} sub-cue timer aligned` : `${userNameDefault} timer aligned`,
          event_id,
          item_id: parseInt(item_id, 10),
          is_sub_cue: isSubCue,
          duration_seconds: dur,
          remaining_seconds: rem,
          time_source: timeSource,
          [stateKey]: 'synced',
          [seqKey]: alignSeq,
          [reasonKey]: reason,
          latency_compensation_ms: compensationMs,
        });
      } catch (e) {
        console.error(`Error in ${prefix}-sync-align:`, e);
        res.status(500).json({ error: `Failed to ${prefix}-sync-align`, details: e.message });
      }
    });

    app.post(`/api/timers/${prefix}-end`, (req, res) => {
      try {
        const { event_id } = req.body || {};
        if (!event_id) return res.status(400).json({ error: 'event_id is required' });
        const synced = syncedMap.get(event_id);
        const pending = pendingMap.get(event_id);
        const wasSubCue = !!(synced?.is_sub_cue ?? pending?.is_sub_cue);
        clearAll(event_id);
        console.log(`${emoji} Offline ${prefix} end - cleared state for event: ${event_id}`);

        const main = getMainTimer(event_id);
        if (main) emit(event_id, 'timerUpdated', main);

        if (wasSubCue) {
          const ts = nowIso();
          const result = db.prepare(`
            UPDATE sub_cue_timers
            SET is_running = 0, is_active = 0, updated_at = ?
            WHERE event_id = ? AND is_running = 1
          `).run(ts, event_id);
          if (result.changes > 0) {
            broadcastUpdate(event_id, 'subCueTimerStopped', {
              event_id,
              stopped_count: result.changes,
            });
          }
        }

        res.json({ success: true, message: `${userNameDefault} time source cleared`, event_id });
      } catch (e) {
        console.error(`Error in ${prefix}-end:`, e);
        res.status(500).json({ error: `Failed to ${prefix}-end`, details: e.message });
      }
    });
  }

  registerSourceRoutes('resolume');
  registerSourceRoutes('mitti');

  // Companion arm/load helpers used by both modules (LAN)
  app.post('/api/timers/start', (req, res) => {
    const { event_id, item_id, started_at } = req.body || {};
    if (!event_id || item_id == null) {
      return res.status(400).json({ error: 'event_id and item_id are required' });
    }
    const ts = nowIso();
    const result = db.prepare(`
      UPDATE active_timers
      SET is_active = 1, is_running = 1, timer_state = 'running',
          started_at = ?, updated_at = ?
      WHERE event_id = ? AND item_id = ?
    `).run(started_at || ts, ts, event_id, item_id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Loaded timer not found for event and item' });
    }
    const row = getMainTimer(event_id);
    emit(event_id, 'timerUpdated', row);
    res.json({
      success: true,
      message: 'Timer started',
      event_id,
      item_id,
    });
  });

  app.post('/api/timers/stop', (req, res) => {
    const { event_id, item_id } = req.body || {};
    if (!event_id) return res.status(400).json({ error: 'event_id is required' });
    const ts = nowIso();
    const timerBeforeStop = db.prepare(`
      SELECT * FROM active_timers
      WHERE event_id = ? AND (item_id = ? OR ? IS NULL)
      LIMIT 1
    `).get(event_id, item_id, item_id);
    db.prepare(`
      UPDATE active_timers SET is_running = 0, is_active = 0, timer_state = 'stopped', updated_at = ?
      WHERE event_id = ? AND (item_id = ? OR ? IS NULL)
    `).run(ts, event_id, item_id, item_id);

    if (timerBeforeStop?.is_running && timerBeforeStop.started_at) {
      const startedAtMs = new Date(timerBeforeStop.started_at).getTime();
      if (Number.isFinite(startedAtMs)) {
        const actualSeconds = Math.floor((Date.now() - startedAtMs) / 1000);
        const scheduledSeconds = Number(timerBeforeStop.duration_seconds) || 0;
        const overtimeMinutes = Math.floor((actualSeconds - scheduledSeconds) / 60);
        if (Math.abs(overtimeMinutes) >= 1) {
          const numericItemId = Number(timerBeforeStop.item_id);
          const overtimeItemId = Number.isFinite(numericItemId)
            ? Math.trunc(numericItemId)
            : timerBeforeStop.item_id;
          db.prepare(`
            INSERT INTO overtime_minutes
              (event_id, item_id, overtime_minutes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(event_id, item_id) DO UPDATE SET
              overtime_minutes = excluded.overtime_minutes,
              updated_at = excluded.updated_at
          `).run(
            event_id,
            String(overtimeItemId),
            overtimeMinutes,
            ts,
            ts
          );
          emit(event_id, 'overtimeUpdate', {
            event_id,
            item_id: overtimeItemId,
            overtimeMinutes,
          });
        }
      }
    }

    const row = getMainTimer(event_id);
    if (row) {
      emit(event_id, 'timerStopped', row);
      emit(event_id, 'timerUpdated', row);
      return res.json(row);
    }
    res.json({});
  });

  app.post('/api/cues/load', (req, res) => {
    try {
      const { event_id, item_id, user_id, cue_is, duration_seconds } = req.body || {};
      if (!event_id || item_id == null) {
        return res.status(400).json({ error: 'event_id and item_id are required' });
      }
      const ts = nowIso();
      const id = randomUUID();
      const rawDuration = Number(duration_seconds);
      const dur =
        duration_seconds == null || !Number.isFinite(rawDuration)
          ? 300
          : Math.max(0, Math.floor(rawDuration));
      db.prepare(`
        INSERT INTO active_timers (
          id, event_id, item_id, user_id, user_name, user_role, timer_state,
          is_active, is_running, started_at, last_loaded_cue_id, cue_is,
          duration_seconds, elapsed_seconds, created_at, updated_at
        ) VALUES (
          @id, @event_id, @item_id, @user_id, @user_name, 'OPERATOR', 'loaded',
          1, 0, '2099-12-31T23:59:59.999Z', @item_id, @cue_is,
          @duration_seconds, 0, @created_at, @updated_at
        )
        ON CONFLICT(event_id) DO UPDATE SET
          item_id = excluded.item_id,
          user_id = excluded.user_id,
          user_name = excluded.user_name,
          timer_state = 'loaded',
          is_active = 1,
          is_running = 0,
          started_at = '2099-12-31T23:59:59.999Z',
          last_loaded_cue_id = excluded.item_id,
          cue_is = COALESCE(excluded.cue_is, active_timers.cue_is),
          duration_seconds = excluded.duration_seconds,
          updated_at = excluded.updated_at
      `).run({
        id,
        event_id,
        item_id: parseInt(item_id, 10),
        user_id: user_id || 'companion',
        user_name: user_id === 'companion-mitti' ? 'Mitti Sync' : user_id === 'companion-resolume' ? 'Resolume Sync' : 'Companion',
        cue_is: cue_is || `CUE ${item_id}`,
        duration_seconds: dur,
        created_at: ts,
        updated_at: ts,
      });
      const row = getMainTimer(event_id);
      emit(event_id, 'timerUpdated', row);
      res.json({ success: true, timer: row });
    } catch (e) {
      console.error('Error in cues/load:', e);
      res.status(500).json({ error: 'Failed to load cue', details: e.message });
    }
  });

  app.put('/api/active-timers/:eventId/:itemId/duration', (req, res) => {
    try {
      const eventId = req.params.eventId;
      const itemId = parseInt(req.params.itemId, 10);
      const dur = Math.max(1, Math.floor(Number(req.body?.duration_seconds) || 0));
      if (!eventId || !Number.isFinite(itemId) || dur < 1) {
        return res.status(400).json({ error: 'eventId, itemId, and duration_seconds required' });
      }
      const ts = nowIso();

      // Update schedule item durations in run_of_show_data if present
      const ros = db.prepare('SELECT * FROM run_of_show_data WHERE event_id = ?').get(eventId);
      if (ros?.schedule_items) {
        let items;
        try {
          items = typeof ros.schedule_items === 'string' ? JSON.parse(ros.schedule_items) : ros.schedule_items;
        } catch {
          items = [];
        }
        if (Array.isArray(items)) {
          const hours = Math.floor(dur / 3600);
          const minutes = Math.floor((dur % 3600) / 60);
          const seconds = dur % 60;
          const updated = items.map((it) =>
            String(it.id) === String(itemId)
              ? { ...it, durationHours: hours, durationMinutes: minutes, durationSeconds: seconds }
              : it
          );
          db.prepare('UPDATE run_of_show_data SET schedule_items = ?, updated_at = ? WHERE event_id = ?').run(
            JSON.stringify(updated),
            ts,
            eventId
          );
        }
      }

      db.prepare(`
        UPDATE active_timers SET duration_seconds = ?, updated_at = ?
        WHERE event_id = ? AND item_id = ?
      `).run(dur, ts, eventId, itemId);

      // Sub-cue duration if that row is a sub timer
      try {
        db.prepare(`
          UPDATE sub_cue_timers SET duration_seconds = ?, updated_at = ?
          WHERE event_id = ? AND item_id = ?
        `).run(dur, ts, eventId, String(itemId));
      } catch {
        // ignore
      }

      const main = getMainTimer(eventId);
      if (main) emit(eventId, 'timerUpdated', main);
      res.json({ success: true, duration_seconds: dur, event_id: eventId, item_id: itemId });
    } catch (e) {
      console.error('Error updating duration:', e);
      res.status(500).json({ error: 'Failed to update duration', details: e.message });
    }
  });

  return {
    applyMediaSyncMeta,
    wrapBroadcast: emit,
  };
}

module.exports = {
  applyMediaSyncMeta,
  wrapBroadcast,
  registerMediaSyncRoutes,
};
