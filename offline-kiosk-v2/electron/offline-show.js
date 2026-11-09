const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { offlineShowRoot, nodeCommand, bundledNodeExe } = require('./runtime-paths');

const OFFLINE_SHOW_URL = 'http://127.0.0.1:3004';
const HEALTH_PATH = '/health';
const EVENTS_PATH = '/api/calendar-events';

let showChild = null;
let startedByKiosk = false;

function requestJson(urlPath, { method = 'GET', body = null, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      `${OFFLINE_SHOW_URL}${urlPath}`,
      {
        method,
        timeout: timeoutMs,
        headers:
          payload == null
            ? { Accept: 'application/json' }
            : {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'Content-Length': payload.length,
              },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch {
            data = raw;
          }
          if (res.statusCode && res.statusCode >= 400) {
            const err = new Error(
              (data && data.error) || `HTTP ${res.statusCode} for ${urlPath}`
            );
            err.statusCode = res.statusCode;
            err.data = data;
            reject(err);
            return;
          }
          resolve(data);
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout talking to Offline Show (${urlPath})`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function isRunning() {
  try {
    const health = await requestJson(HEALTH_PATH, { timeoutMs: 2500 });
    return health?.status === 'healthy';
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntilReady(timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isRunning()) return true;
    await sleep(500);
  }
  return false;
}

function toYmd(dateValue) {
  if (!dateValue) return '';
  const raw = String(dateValue).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function isQuickMode(calEvent) {
  const sd =
    calEvent?.schedule_data && typeof calEvent.schedule_data === 'object'
      ? calEvent.schedule_data
      : {};
  if (sd.quickMode === true) return true;
  if (sd.source === 'quick-mode') return true;
  if (/^Quick Mode/i.test(String(calEvent?.name || ''))) return true;
  return false;
}

function mapCalendarEvent(calEvent) {
  const sd =
    calEvent?.schedule_data && typeof calEvent.schedule_data === 'object'
      ? calEvent.schedule_data
      : {};
  const quick = isQuickMode(calEvent);
  const id = quick
    ? String(calEvent.id || '')
    : String(sd.eventId || calEvent.id || '');
  return {
    id,
    calendarId: calEvent.id || null,
    name: calEvent.name || 'Untitled event',
    date: toYmd(calEvent.date),
    location: typeof sd.location === 'string' ? sd.location : '',
    eventType: typeof sd.eventType === 'string' ? sd.eventType : '',
    numberOfDays: Math.max(1, Number(sd.numberOfDays) || 1),
    timezone: typeof sd.timezone === 'string' ? sd.timezone : '',
    isQuickMode: quick,
  };
}

async function listEvents() {
  const rows = await requestJson(EVENTS_PATH, { timeoutMs: 20000 });
  if (!Array.isArray(rows)) {
    throw new Error('Unexpected calendar-events response');
  }
  return rows.map(mapCalendarEvent).filter((e) => e.id);
}

async function getConnectivity() {
  return requestJson('/api/connectivity-status', { timeoutMs: 20000 });
}

async function getCloudMode() {
  return requestJson('/api/cloud-mode', { timeoutMs: 8000 });
}

async function setCloudMode(mode) {
  return requestJson('/api/cloud-mode', {
    method: 'PATCH',
    body: { mode, updatedBy: 'offline-kiosk' },
    timeoutMs: 20000,
  });
}

async function getTokenStatus() {
  return requestJson('/api/railway-api-token', { timeoutMs: 8000 });
}

async function saveRailwayToken(token) {
  return requestJson('/api/railway-api-token', {
    method: 'PUT',
    body: { token },
    timeoutMs: 30000,
  });
}

async function clearRailwayToken() {
  return requestJson('/api/railway-api-token', {
    method: 'DELETE',
    timeoutMs: 8000,
  });
}

async function syncFromCloud() {
  return requestJson('/api/sync-from-cloud', {
    method: 'POST',
    body: {},
    timeoutMs: 120000,
  });
}

/**
 * After Offline Show is healthy: read connectivity, optionally enable cloud
 * (connect-only, no upload), sync Neon → SQLite, then return events.
 */
async function prepareEvents({ preferCloud = true, sync = true } = {}) {
  let connectivity = null;
  let cloudMode = null;
  let token = null;
  let syncResult = null;
  const notes = [];

  try {
    connectivity = await getConnectivity();
    cloudMode = {
      mode: connectivity.cloudMode,
      lanOnly: connectivity.lanOnly,
      cloudConnected: connectivity.cloudConnected,
    };
    token = connectivity.railwayApiToken || (await getTokenStatus());
  } catch (e) {
    notes.push(e instanceof Error ? e.message : 'Connectivity status failed');
  }

  // Kiosk default: Cloud on whenever we can (saved Integration token).
  if (preferCloud) {
    const tokenReady = Boolean(token?.configured);
    if (!tokenReady) {
      notes.push(
        'LAN only for now — paste an Integration token (ros_itok_…) so Cloud can turn on automatically.'
      );
    } else if (!cloudMode?.cloudConnected) {
      try {
        cloudMode = await setCloudMode('cloud-connected');
        notes.push('Cloud on (connect-only).');
        try {
          connectivity = await getConnectivity();
        } catch {
          /* keep prior */
        }
      } catch (e) {
        notes.push(
          `Could not enable Cloud on: ${e instanceof Error ? e.message : 'error'}. Staying LAN-only.`
        );
      }
    } else {
      notes.push('Cloud already on.');
    }
  }

  if (sync && cloudMode?.cloudConnected) {
    try {
      syncResult = await syncFromCloud();
      const n =
        syncResult?.calendarEvents ??
        syncResult?.events ??
        syncResult?.synced?.calendarEvents ??
        null;
      notes.push(
        typeof n === 'number' ? `Synced ${n} calendar events from cloud.` : 'Synced from cloud.'
      );
    } catch (e) {
      notes.push(
        `Cloud sync failed (${e instanceof Error ? e.message : 'error'}); listing local SQLite.`
      );
    }
  }

  const events = await listEvents();
  return {
    ok: true,
    events,
    connectivity,
    cloudMode,
    token,
    syncResult,
    notes,
  };
}

function ensureOfflineShowInstall() {
  const root = offlineShowRoot();
  if (!fs.existsSync(root)) {
    return { ok: false, error: `Offline Show folder not found: ${root}` };
  }
  const serverJs = path.join(root, 'server', 'server.js');
  if (!fs.existsSync(serverJs)) {
    return { ok: false, error: `Offline Show server missing: ${serverJs}` };
  }
  const nodeModules = path.join(root, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    return {
      ok: false,
      error:
        'Offline Show dependencies missing. Rebuild the portable kiosk (or run npm install in engines\\offline-show).',
    };
  }
  return { ok: true, root, serverJs };
}

function spawnWithNode(root) {
  if (showChild && !showChild.killed) return showChild;
  const nodeBin = nodeCommand();
  const child = spawn(nodeBin, ['server/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      OFFLINE_PORT: '3004',
      PORT: '3004',
      // Prefer bundled Node's directory on PATH for any child tools
      PATH: bundledNodeExe()
        ? `${path.dirname(bundledNodeExe())}${path.delimiter}${process.env.PATH || ''}`
        : process.env.PATH,
    },
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
  });
  showChild = child;
  startedByKiosk = true;
  child.on('exit', () => {
    if (showChild === child) {
      showChild = null;
      startedByKiosk = false;
    }
  });
  return child;
}

async function startOfflineShow() {
  if (await isRunning()) {
    return {
      ok: true,
      alreadyRunning: true,
      startedByKiosk: false,
      url: OFFLINE_SHOW_URL,
    };
  }

  const install = ensureOfflineShowInstall();
  if (!install.ok) return install;

  try {
    spawnWithNode(install.root);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to spawn Offline Show',
    };
  }

  const ready = await waitUntilReady(90000);
  if (!ready) {
    return {
      ok: false,
      error:
        'Offline Show did not become healthy on :3004. Check engines/offline-show install / port.',
    };
  }

  return {
    ok: true,
    alreadyRunning: false,
    startedByKiosk,
    url: OFFLINE_SHOW_URL,
  };
}

async function stopOfflineShow() {
  if (!startedByKiosk || !showChild) {
    return {
      ok: true,
      stopped: false,
      note: 'Offline Show was not started by this kiosk (left running).',
    };
  }
  try {
    showChild.kill();
  } catch {
    /* ignore */
  }
  showChild = null;
  startedByKiosk = false;
  await sleep(400);
  return { ok: true, stopped: true };
}

async function getStatus() {
  const running = await isRunning();
  let cloudMode = null;
  let token = null;
  if (running) {
    try {
      cloudMode = await getCloudMode();
      token = await getTokenStatus();
    } catch {
      /* ignore */
    }
  }
  return {
    running,
    url: OFFLINE_SHOW_URL,
    startedByKiosk: Boolean(startedByKiosk && showChild),
    root: offlineShowRoot(),
    cloudMode,
    token,
  };
}

module.exports = {
  OFFLINE_SHOW_URL,
  getStatus,
  startOfflineShow,
  stopOfflineShow,
  listEvents,
  isRunning,
  getConnectivity,
  getCloudMode,
  setCloudMode,
  getTokenStatus,
  saveRailwayToken,
  clearRailwayToken,
  syncFromCloud,
  prepareEvents,
};
