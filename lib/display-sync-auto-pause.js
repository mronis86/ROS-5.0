/**
 * Auto-pause Display sync for calendar events whose last show day is 14+ days ago.
 * Stops forgotten follower/PPT tabs from polling Railway after events are long over.
 */

const { isDisplaySyncEnabled, parseScheduleData } = require('./display-sync');
const { setDisplaySyncEnabledCached, rememberDisplaySync } = require('./display-sync-cache');

const DEFAULT_AGE_DAYS = 14;
const BATCH_LIMIT = 80;

let lastRun = {
  at: null,
  paused: 0,
  scanned: 0,
  ageDays: DEFAULT_AGE_DAYS,
  eventIds: [],
  error: null,
};

function readAgeDays() {
  const n = parseInt(process.env.DISPLAY_SYNC_AUTO_PAUSE_DAYS || String(DEFAULT_AGE_DAYS), 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_AGE_DAYS;
}

function eventEndDate(row) {
  const sd = parseScheduleData(row.schedule_data);
  const days = Math.max(1, parseInt(String(sd.numberOfDays || 1), 10) || 1);
  const start = row.date instanceof Date ? row.date : new Date(row.date);
  if (!Number.isFinite(start.getTime())) return null;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + (days - 1));
  return end;
}

/**
 * Pause display sync for stale events. Returns { paused, scanned, eventIds }.
 * @param {import('pg').Pool} pool
 * @param {{ broadcastUpdate?: Function, ageDays?: number }} [opts]
 */
async function autoPauseStaleDisplaySync(pool, opts = {}) {
  const ageDays = opts.ageDays != null ? opts.ageDays : readAgeDays();
  const broadcastUpdate = typeof opts.broadcastUpdate === 'function' ? opts.broadcastUpdate : null;
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - ageDays);

  const result = await pool.query(
    `SELECT id, name, date, schedule_data
     FROM calendar_events
     WHERE deleted_at IS NULL
       AND date IS NOT NULL
     ORDER BY date ASC
     LIMIT 2000`
  );

  const candidates = [];
  for (const row of result.rows || []) {
    if (!isDisplaySyncEnabled(row.schedule_data)) continue;
    const end = eventEndDate(row);
    if (!end || end >= cutoff) continue;
    candidates.push(row);
    if (candidates.length >= BATCH_LIMIT) break;
  }

  const pausedIds = [];
  for (const row of candidates) {
    const id = String(row.id);
    const updated = await setDisplaySyncEnabledCached(pool, id, false);
    if (!updated?.ok) continue;
    rememberDisplaySync(id, false);
    pausedIds.push(id);
    if (broadcastUpdate) {
      try {
        broadcastUpdate(id, 'displaySyncUpdate', {
          event_id: id,
          displaySyncEnabled: false,
          reason: 'auto-pause-stale',
          ageDays,
        });
      } catch {
        /* ignore */
      }
    }
  }

  lastRun = {
    at: new Date().toISOString(),
    paused: pausedIds.length,
    scanned: (result.rows || []).length,
    ageDays,
    eventIds: pausedIds.slice(0, 40),
    error: null,
  };

  if (pausedIds.length > 0) {
    console.log(
      `[display-sync-auto-pause] paused ${pausedIds.length} event(s) older than ${ageDays}d (scanned ${lastRun.scanned})`
    );
  }

  return lastRun;
}

function getDisplaySyncAutoPauseStatus() {
  return { ...lastRun, ageDays: lastRun.ageDays || readAgeDays() };
}

function startDisplaySyncAutoPause(pool, opts = {}) {
  if (!pool) return;
  if (process.env.DISPLAY_SYNC_AUTO_PAUSE_DISABLED === 'true') {
    console.log('[display-sync-auto-pause] disabled via DISPLAY_SYNC_AUTO_PAUSE_DISABLED');
    return;
  }

  const intervalHours = Math.max(
    1,
    parseInt(process.env.DISPLAY_SYNC_AUTO_PAUSE_INTERVAL_HOURS || '6', 10) || 6
  );

  const run = () => {
    autoPauseStaleDisplaySync(pool, opts).catch((err) => {
      lastRun = {
        ...lastRun,
        at: new Date().toISOString(),
        error: err?.message || String(err),
      };
      console.error('[display-sync-auto-pause] failed:', err?.message || err);
    });
  };

  // Shortly after boot, then every N hours
  setTimeout(run, 2 * 60 * 1000);
  setInterval(run, intervalHours * 60 * 60 * 1000);
  console.log(
    `[display-sync-auto-pause] scheduled (first ~2m, then every ${intervalHours}h; age=${readAgeDays()}d)`
  );
}

module.exports = {
  autoPauseStaleDisplaySync,
  getDisplaySyncAutoPauseStatus,
  startDisplaySyncAutoPause,
  readAgeDays,
};
