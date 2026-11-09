/**
 * Fast in-memory view of per-event displaySyncEnabled for poll short-circuits.
 * Backed by calendar_events.schedule_data; refreshed on load/set and TTL.
 */

const { loadDisplaySyncEnabled, setDisplaySyncEnabled } = require('./display-sync');

const TTL_MS = 30_000;
/** @type {Map<string, { enabled: boolean; at: number }>} */
const cache = new Map();

function cacheKey(eventId) {
  return String(eventId || '').toLowerCase();
}

function rememberDisplaySync(eventId, enabled) {
  const key = cacheKey(eventId);
  if (!key) return;
  cache.set(key, { enabled: enabled !== false, at: Date.now() });
}

async function getDisplaySyncEnabledCached(pool, eventId) {
  const key = cacheKey(eventId);
  if (!key) return true;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.enabled;
  const enabled = await loadDisplaySyncEnabled(pool, eventId);
  rememberDisplaySync(eventId, enabled);
  return enabled;
}

async function setDisplaySyncEnabledCached(pool, calendarEventId, enabled) {
  const result = await setDisplaySyncEnabled(pool, calendarEventId, enabled);
  if (result?.ok) rememberDisplaySync(calendarEventId, enabled === true);
  return result;
}

function createDisplaySyncPollGuard(pool) {
  return async function displaySyncPollGuard(req, res, next) {
    try {
      if ((req.method || 'GET').toUpperCase() !== 'GET') return next();
      const path = (req.originalUrl || req.url || '').split('?')[0] || '';
      const patterns = [
        /^\/api\/active-timers\/([0-9a-f-]{36})(?:\/|$)/i,
        /^\/api\/operator-countdown\/([0-9a-f-]{36})(?:\/|$)/i,
        /^\/api\/timer-messages\/([0-9a-f-]{36})(?:\/|$)/i,
        /^\/api\/powerpoint\/([0-9a-f-]{36})\/playback\/?$/i,
        /^\/api\/display-sync\/([0-9a-f-]{36})$/i,
      ];
      let eventId = null;
      for (const re of patterns) {
        const m = path.match(re);
        if (m) {
          eventId = m[1];
          break;
        }
      }
      if (!eventId) return next();

      const enabled = await getDisplaySyncEnabledCached(pool, eventId);
      // Always answer display-sync from cache so resume-check polls stay cheap.
      if (/\/display-sync\//i.test(path)) {
        res.setHeader('X-ROS-Display-Sync', enabled ? 'enabled' : 'paused');
        return res.status(200).json({ eventId, displaySyncEnabled: enabled !== false });
      }
      if (enabled) return next();

      res.setHeader('X-ROS-Display-Sync', 'paused');
      // Cheap empty payloads so forgotten tabs stop doing DB work until clients stop polling.
      if (/\/active-timers\//i.test(path)) return res.status(200).json([]);
      if (/\/operator-countdown\//i.test(path)) return res.status(200).json(null);
      if (/\/timer-messages\//i.test(path)) return res.status(200).json([]);
      if (/\/powerpoint\//i.test(path)) {
        return res.status(200).json({ displaySyncEnabled: false, paused: true, connected: false });
      }
      return res.status(204).end();
    } catch (err) {
      console.warn('[display-sync-guard]', err?.message || err);
      return next();
    }
  };
}

module.exports = {
  rememberDisplaySync,
  getDisplaySyncEnabledCached,
  setDisplaySyncEnabledCached,
  createDisplaySyncPollGuard,
};
