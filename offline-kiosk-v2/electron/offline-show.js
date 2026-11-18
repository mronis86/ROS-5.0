const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { offlineShowRoot, nodeCommand, bundledNodeExe } = require('./runtime-paths');
const { loadStoredToken, saveStoredToken, clearStoredToken } = require('./token-store');

const OFFLINE_SHOW_URL = 'http://127.0.0.1:3004';
const HEALTH_PATH = '/health';
/** Local SQLite mirror — never go through Cloud proxy to Railway for the event list. */
const EVENTS_PATH = '/api/kiosk/calendar-events';

let showChild = null;
let startedByKiosk = false;
/** Log once per process that Offline Show Node trusts the OS CA store. */
let loggedSystemCaMode = false;

/** Node 22+ flag so corp SSL inspection (Windows root store) works like Chromium. */
const USE_SYSTEM_CA_FLAG = '--use-system-ca';

function withSystemCaNodeOptions(env) {
  const base = env && typeof env === 'object' ? { ...env } : { ...process.env };
  const existing = typeof base.NODE_OPTIONS === 'string' ? base.NODE_OPTIONS : '';
  if (!existing.includes(USE_SYSTEM_CA_FLAG)) {
    base.NODE_OPTIONS = `${existing} ${USE_SYSTEM_CA_FLAG}`.trim();
  }
  return base;
}

function logSystemCaModeOnce(showLogPath) {
  if (loggedSystemCaMode) return;
  loggedSystemCaMode = true;
  const msg = `Offline Show Node system CA mode enabled (${USE_SYSTEM_CA_FLAG})`;
  try {
    const { cloudLog } = require('./kiosk-log');
    cloudLog(msg);
  } catch {
    /* ignore */
  }
  if (showLogPath) {
    try {
      fs.appendFileSync(showLogPath, `[kiosk] ${msg}\n`, 'utf8');
    } catch {
      /* ignore */
    }
  }
}

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

function mergeTokenStatus(serverToken) {
  const stored = getStoredTokenStatus();
  if (serverToken?.configured) {
    return {
      ...serverToken,
      pending: false,
      kioskSaved: stored.configured,
    };
  }
  if (stored.configured) {
    return {
      configured: true,
      prefix: stored.prefix,
      source: stored.source || 'kiosk',
      locked: false,
      pending: true,
      kioskSaved: true,
      canWrite: serverToken?.canWrite ?? null,
      writeError: serverToken?.writeError ?? null,
    };
  }
  return (
    serverToken || {
      configured: false,
      prefix: null,
      source: null,
      locked: false,
      pending: false,
      kioskSaved: false,
    }
  );
}

async function getConnectivity() {
  const connectivity = await requestJson('/api/connectivity-status', { timeoutMs: 20000 });
  if (!connectivity || typeof connectivity !== 'object') return connectivity;
  return {
    ...connectivity,
    railwayApiToken: mergeTokenStatus(connectivity.railwayApiToken),
  };
}

/** Clear probe cache and optionally retry TLS/Railway/Neon after Cloud on. */
async function refreshConnectivity({ warm = false } = {}) {
  const result = await requestJson('/api/connectivity-refresh', {
    method: 'POST',
    body: { warm: Boolean(warm) },
    timeoutMs: 45000,
  });
  const connectivity = result?.connectivity || result;
  if (!connectivity || typeof connectivity !== 'object') {
    return { connectivity: null, warmup: result?.warmup || null };
  }
  return {
    connectivity: {
      ...connectivity,
      railwayApiToken: mergeTokenStatus(connectivity.railwayApiToken),
    },
    warmup: result?.warmup || null,
  };
}

async function runCloudDiagnostics() {
  const { cloudLog, cloudWarn, logsDir, readTail } = require('./kiosk-log');
  cloudLog('Cloud diagnostics requested');
  if (!(await isRunning())) {
    cloudWarn('Offline Show not running — cannot run server-side probes');
    return {
      ok: false,
      error: 'Start Offline Show first, then run Cloud diagnostics.',
      logsDir: logsDir(),
      kioskLog: readTail('cloud', 32 * 1024),
    };
  }
  try {
    const report = await requestJson('/api/connectivity-diagnostics', {
      method: 'POST',
      body: {},
      timeoutMs: 90000,
    });
    cloudLog('Cloud diagnostics complete', {
      hint: report?.hint,
      railwayFetch: report?.probes?.railwayHealth?.fetch?.ok,
      railwayHttps: report?.probes?.railwayHealth?.https?.ok,
      neonFetch: report?.probes?.railwayDeep?.fetch?.ok,
      lanOnly: report?.meta?.lanOnly,
    });
    return {
      ok: true,
      report,
      logsDir: logsDir(),
      kioskLog: readTail('cloud', 32 * 1024),
      showLog: readTail('offline-show', 32 * 1024),
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Diagnostics failed';
    cloudWarn('Cloud diagnostics failed', { error });
    return {
      ok: false,
      error,
      logsDir: logsDir(),
      kioskLog: readTail('cloud', 32 * 1024),
      showLog: readTail('offline-show', 32 * 1024),
    };
  }
}

async function getCloudMode() {
  return requestJson('/api/cloud-mode', { timeoutMs: 8000 });
}

async function setCloudMode(mode, { soft = false } = {}) {
  return requestJson('/api/cloud-mode', {
    method: 'PATCH',
    body: { mode, updatedBy: 'offline-kiosk', soft: Boolean(soft) },
    timeoutMs: 20000,
  });
}

async function getTokenStatus() {
  return requestJson('/api/railway-api-token', { timeoutMs: 8000 });
}

async function saveRailwayToken(token) {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (!trimmed) {
    throw new Error('token is required');
  }
  // Always keep a local copy so operators can set the token before Offline Show starts.
  const stored = saveStoredToken(trimmed);
  if (!(await isRunning())) {
    return {
      configured: true,
      prefix: stored.prefix,
      source: 'kiosk',
      locked: false,
      pending: true,
      kioskSaved: true,
    };
  }
  try {
    const saved = await requestJson('/api/railway-api-token', {
      method: 'PUT',
      body: { token: trimmed, softPersist: true },
      timeoutMs: 30000,
    });
    return mergeTokenStatus(saved);
  } catch (e) {
    // Keep the kiosk file even if Railway validation / apply fails (offline, 403, etc.).
    return {
      configured: true,
      prefix: stored.prefix,
      source: 'kiosk',
      locked: false,
      pending: true,
      kioskSaved: true,
      warning: e instanceof Error ? e.message : 'Token saved on kiosk; Offline Show apply pending',
    };
  }
}

async function clearRailwayToken() {
  clearStoredToken();
  const empty = {
    configured: false,
    prefix: null,
    source: null,
    locked: false,
    pending: false,
    kioskSaved: false,
  };
  if (!(await isRunning())) {
    return empty;
  }
  try {
    const cleared = await requestJson('/api/railway-api-token', {
      method: 'DELETE',
      timeoutMs: 8000,
    });
    return { ...empty, ...(cleared && typeof cleared === 'object' ? cleared : {}), kioskSaved: false };
  } catch {
    return empty;
  }
}

/** After Offline Show is up, push any locally saved token into its SQLite. */
async function applyPendingRailwayToken() {
  const stored = loadStoredToken();
  if (!stored.configured || !stored.token) {
    return { ok: true, applied: false, token: mergeTokenStatus(null) };
  }
  if (!(await isRunning())) {
    return {
      ok: false,
      applied: false,
      error: 'Offline Show is not running',
      token: mergeTokenStatus(null),
    };
  }
  try {
    const status = await getTokenStatus();
    if (status?.configured && status?.prefix === stored.prefix && status?.source === 'db') {
      return { ok: true, applied: false, token: mergeTokenStatus(status) };
    }
  } catch {
    /* continue and write */
  }
  try {
    // softPersist: always write into Offline Show SQLite from the kiosk file even when
    // Railway validation is unreachable / delayed — otherwise Start stays LAN-only.
    const token = await requestJson('/api/railway-api-token', {
      method: 'PUT',
      body: { token: stored.token, softPersist: true },
      timeoutMs: 30000,
    });
    return { ok: true, applied: true, token: mergeTokenStatus(token) };
  } catch (e) {
    return {
      ok: false,
      applied: false,
      error: e instanceof Error ? e.message : 'Token apply failed',
      // Keep reporting the kiosk-saved token so UI / Cloud prefer logic still sees it.
      token: mergeTokenStatus(null),
    };
  }
}

function getStoredTokenStatus() {
  const stored = loadStoredToken();
  return {
    configured: stored.configured,
    prefix: stored.prefix || null,
    source: stored.configured ? 'kiosk' : null,
    locked: false,
    pending: stored.configured,
  };
}

async function syncFromCloud({ calendarOnly = false } = {}) {
  return requestJson('/api/sync-from-cloud', {
    method: 'POST',
    body: { calendarOnly: Boolean(calendarOnly) },
    timeoutMs: calendarOnly ? 60000 : 120000,
  });
}

/**
 * After Offline Show is healthy: read connectivity, optionally enable cloud
 * (connect-only, no upload), sync Neon → SQLite, then return events.
 *
 * Options:
 * - preferCloud: soft-enable Cloud when a token exists (default true)
 * - sync: pull from Railway into SQLite before listing (default true)
 * - warm: extra TLS warm after Cloud already on (default false — Start already warmed)
 * - calendarOnly: sync calendar rows only, not every event's ROS/live state (default true)
 */
async function prepareEvents({
  preferCloud = true,
  sync = true,
  warm = false,
  calendarOnly = true,
} = {}) {
  let connectivity = null;
  let cloudMode = null;
  let token = null;
  let syncResult = null;
  const notes = [];

  // Push any kiosk-saved token into Offline Show SQLite before cloud decisions.
  try {
    const pending = await applyPendingRailwayToken();
    if (pending?.token) token = mergeTokenStatus(pending.token);
    if (pending?.applied) notes.push('Applied saved Integration token.');
    else if (pending?.error) notes.push(`Token apply: ${pending.error}`);
  } catch (e) {
    notes.push(e instanceof Error ? e.message : 'Token apply failed');
  }

  try {
    connectivity = await getConnectivity();
    cloudMode = {
      mode: connectivity.cloudMode,
      lanOnly: connectivity.lanOnly,
      cloudConnected: connectivity.cloudConnected,
    };
    token = mergeTokenStatus(
      connectivity.railwayApiToken ||
        (await getTokenStatus().catch(() => null)) ||
        token
    );
  } catch (e) {
    // Keep any token we already merged from softPersist — do not wipe on probe miss.
    try {
      token = mergeTokenStatus(token || (await getTokenStatus().catch(() => null)));
    } catch {
      /* keep prior */
    }
    notes.push(e instanceof Error ? e.message : 'Connectivity status failed');
  }

  // Kiosk default: Cloud on whenever a token is saved (soft — do not stay LAN-only
  // just because the Railway health probe failed once at start).
  if (preferCloud) {
    const tokenReady = Boolean(token?.configured);
    if (!tokenReady) {
      notes.push(
        'LAN only for now — paste an Integration token (ros_itok_…) so Cloud can turn on automatically.'
      );
    } else if (!cloudMode?.cloudConnected) {
      try {
        cloudMode = await setCloudMode('cloud-connected', { soft: true });
        if (cloudMode?.sync?.warning) {
          notes.push(`Cloud on (connect-only; ${cloudMode.sync.warning}).`);
        } else if (cloudMode?.sync?.warmed) {
          notes.push(
            `Cloud on (connect-only; Railway/Neon warmed in ${cloudMode.sync.attempts || 1} try).`
          );
        } else {
          notes.push('Cloud on (connect-only).');
        }
        try {
          // After soft Cloud-on, pills need a refresh. Only re-warm when asked —
          // setCloudMode(soft) already ran warmCloudConnectivity.
          const refreshed = await refreshConnectivity({ warm: Boolean(warm) });
          connectivity = refreshed.connectivity || (await getConnectivity());
          token = mergeTokenStatus(connectivity?.railwayApiToken || token);
          if (refreshed.warmup && !refreshed.warmup.neonOk) {
            notes.push('Neon still waking — use Recheck if calendar sync fails.');
          }
        } catch {
          try {
            connectivity = await getConnectivity();
            token = mergeTokenStatus(connectivity.railwayApiToken || token);
          } catch {
            /* keep prior */
          }
        }
      } catch (e) {
        notes.push(
          `Could not enable Cloud on: ${e instanceof Error ? e.message : 'error'}. Staying LAN-only.`
        );
      }
    } else {
      notes.push('Cloud already on.');
      if (warm) {
        try {
          const refreshed = await refreshConnectivity({ warm: true });
          connectivity = refreshed.connectivity || connectivity;
          token = mergeTokenStatus(connectivity?.railwayApiToken || token);
        } catch {
          /* keep prior */
        }
      }
    }
  }

  if (sync && cloudMode?.cloudConnected) {
    try {
      syncResult = await syncFromCloud({ calendarOnly: Boolean(calendarOnly) });
      const n =
        syncResult?.calendarEvents ??
        syncResult?.events ??
        syncResult?.synced?.calendarEvents ??
        null;
      notes.push(
        typeof n === 'number'
          ? calendarOnly
            ? `Synced ${n} calendar events from cloud.`
            : `Deep-synced ${n} calendar events (+ run-of-show) from cloud.`
          : 'Synced from cloud.'
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

function offlineShowLogPaths(root) {
  const { logsDir, logPath: kioskLogPath, setPackagedLogsRoot } = require('./kiosk-log');
  try {
    const { app } = require('electron');
    if (app?.isPackaged) {
      setPackagedLogsRoot(path.join(path.dirname(app.getPath('exe')), 'kiosk-data', 'logs'));
    }
  } catch {
    /* ignore */
  }
  const dir = logsDir();
  const showLog = path.join(dir, `offline-show-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.log`);
  // Also tell Offline Show where to write cloud-* logs (same folder).
  return { dir, showLog, cloudLogHint: kioskLogPath('cloud') };
}

function spawnWithNode(root) {
  if (showChild && !showChild.killed) return showChild;
  const nodeBin = nodeCommand();
  const { dir: logDir, showLog } = offlineShowLogPaths(root);
  let outFd = 'ignore';
  let errFd = 'ignore';
  try {
    fs.mkdirSync(logDir, { recursive: true });
    outFd = fs.openSync(showLog, 'a');
    errFd = outFd;
    fs.appendFileSync(
      showLog,
      `\n===== Offline Show start ${new Date().toISOString()} node=${nodeBin} =====\n`,
      'utf8'
    );
  } catch {
    outFd = 'ignore';
    errFd = 'ignore';
  }
  // Trust Windows/macOS system CAs (corp SSL inspection). Do not disable TLS verify.
  logSystemCaModeOnce(typeof showLog === 'string' ? showLog : null);
  const childEnv = withSystemCaNodeOptions({
    ...process.env,
    OFFLINE_PORT: '3004',
    PORT: '3004',
    OFFLINE_SHOW_LOG_DIR: logDir,
    // Prefer bundled Node's directory on PATH for any child tools
    PATH: bundledNodeExe()
      ? `${path.dirname(bundledNodeExe())}${path.delimiter}${process.env.PATH || ''}`
      : process.env.PATH,
  });
  const child = spawn(nodeBin, [USE_SYSTEM_CA_FLAG, 'server/server.js'], {
    cwd: root,
    env: childEnv,
    stdio: ['ignore', outFd, errFd],
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
    try {
      if (typeof outFd === 'number') fs.closeSync(outFd);
    } catch {
      /* ignore */
    }
  });
  return child;
}

async function startOfflineShow() {
  const finishStart = async ({ alreadyRunning }) => {
    const pending = await applyPendingRailwayToken();
    let cloudMode = null;
    let connectivity = null;
    const token = mergeTokenStatus(pending?.token || null);
    // Always prefer Cloud when a token is available (soft enable so Start is not blocked
    // by a transient Railway health probe failure).
    if (token.configured) {
      try {
        cloudMode = await setCloudMode('cloud-connected', { soft: true });
      } catch (e) {
        cloudMode = {
          error: e instanceof Error ? e.message : 'Could not enable Cloud',
        };
      }
    }
    // Return probe pills with Start so the renderer can paint Status immediately
    // (before the slower event sync). setCloudMode already warmed TLS when Cloud on;
    // a non-warm refresh clears cache and reads pills without a second full warm loop.
    try {
      if (cloudMode?.cloudConnected) {
        const refreshed = await refreshConnectivity({ warm: false });
        connectivity = refreshed.connectivity || (await getConnectivity());
      } else {
        connectivity = await getConnectivity();
      }
    } catch {
      try {
        connectivity = await getConnectivity();
      } catch {
        connectivity = null;
      }
    }
    return {
      ok: true,
      alreadyRunning,
      startedByKiosk: alreadyRunning ? false : startedByKiosk,
      url: OFFLINE_SHOW_URL,
      tokenApplied: Boolean(pending?.applied),
      token: mergeTokenStatus(connectivity?.railwayApiToken || token),
      cloudMode:
        cloudMode && typeof cloudMode.cloudConnected === 'boolean'
          ? cloudMode
          : connectivity
            ? {
                mode: connectivity.cloudMode,
                lanOnly: connectivity.lanOnly,
                cloudConnected: connectivity.cloudConnected,
              }
            : cloudMode,
      connectivity,
      preferCloud: Boolean(token.configured),
    };
  };

  if (await isRunning()) {
    return finishStart({ alreadyRunning: true });
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

  return finishStart({ alreadyRunning: false });
}

/** Kill any Node still serving Offline Show (holds locks on engines/offline-show). */
function killOrphanOfflineShowProcesses() {
  if (process.platform !== 'win32') return;
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        [
          "$ErrorActionPreference='SilentlyContinue'",
          // Match Offline Show server.js regardless of which Node started it.
          "$procs = Get-CimInstance Win32_Process | Where-Object {",
          "  $_.Name -match '^(node|node\\.exe)$' -and $_.CommandLine -and (",
          "    $_.CommandLine -match 'offline-show[\\\\/]+server[\\\\/]+server\\.js' -or",
          "    ($_.CommandLine -match 'server[\\\\/]+server\\.js' -and $_.CommandLine -match 'offline-show')",
          "  )",
          "}",
          "foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }",
          // Free port 3004 if something else is still bound.
          "$conns = Get-NetTCPConnection -LocalPort 3004 -State Listen -ErrorAction SilentlyContinue",
          "foreach ($c in @($conns)) {",
          "  if ($c.OwningProcess -and $c.OwningProcess -gt 0) {",
          "    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue",
          "  }",
          "}",
        ].join('; '),
      ],
      { windowsHide: true, stdio: 'ignore', timeout: 15000 }
    );
  } catch {
    /* ignore */
  }
}

async function stopOfflineShow({ force = true } = {}) {
  let stoppedChild = false;
  if (showChild) {
    try {
      if (process.platform === 'win32' && showChild.pid) {
        try {
          execFileSync('taskkill', ['/F', '/PID', String(showChild.pid), '/T'], {
            windowsHide: true,
            stdio: 'ignore',
          });
        } catch {
          try {
            showChild.kill();
          } catch {
            /* ignore */
          }
        }
      } else {
        showChild.kill();
      }
      stoppedChild = true;
    } catch {
      /* ignore */
    }
    showChild = null;
  }
  startedByKiosk = false;

  if (force) {
    killOrphanOfflineShowProcesses();
  }

  await sleep(400);
  const stillUp = await isRunning();
  return {
    ok: !stillUp,
    stopped: stoppedChild || !stillUp,
    running: stillUp,
    note: stillUp ? 'Offline Show still answering on :3004 after stop' : undefined,
  };
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
  token = mergeTokenStatus(token);
  return {
    running,
    url: OFFLINE_SHOW_URL,
    startedByKiosk: Boolean(startedByKiosk && showChild),
    root: offlineShowRoot(),
    cloudMode,
    token,
  };
}

async function getPptBridgeStatus(eventId) {
  const id = String(eventId || '').trim();
  if (!id) {
    return { ok: false, online: false, reason: 'no-event', message: 'Select an event first.' };
  }
  if (!(await isRunning())) {
    return {
      ok: false,
      online: false,
      reason: 'show-off',
      message: 'Start Offline Show to check PPT Bridge.',
    };
  }
  try {
    const data = await requestJson(
      `/api/kiosk/ppt-bridge-status?eventId=${encodeURIComponent(id)}`,
      { timeoutMs: 12000 }
    );
    return data && typeof data === 'object' ? data : { ok: false, online: false, error: 'Bad response' };
  } catch (e) {
    return {
      ok: false,
      online: false,
      eventId: id,
      error: e instanceof Error ? e.message : 'PPT status failed',
    };
  }
}

async function getVmixBridgeStatus(eventId) {
  const id = String(eventId || '').trim();
  if (!id) {
    return { ok: false, online: false, reason: 'no-event', message: 'Select an event first.' };
  }
  if (!(await isRunning())) {
    return {
      ok: false,
      online: false,
      reason: 'show-off',
      message: 'Start Offline Show to check vMix Bridge.',
    };
  }
  try {
    const data = await requestJson(
      `/api/kiosk/vmix-bridge-status?eventId=${encodeURIComponent(id)}`,
      { timeoutMs: 12000 }
    );
    return data && typeof data === 'object' ? data : { ok: false, online: false, error: 'Bad response' };
  } catch (e) {
    return {
      ok: false,
      online: false,
      eventId: id,
      error: e instanceof Error ? e.message : 'vMix status failed',
    };
  }
}

async function listDisplayClients({ kind = 'green-room' } = {}) {
  if (!(await isRunning())) {
    return {
      ok: false,
      clients: [],
      reason: 'show-off',
      error: 'Start Offline Show to list Green Room clients.',
    };
  }
  try {
    const q = kind ? `?kind=${encodeURIComponent(kind)}` : '';
    const data = await requestJson(`/api/kiosk/display-clients${q}`, { timeoutMs: 15000 });
    return data && typeof data === 'object'
      ? { ok: true, ...data }
      : { ok: false, clients: [], error: 'Bad response' };
  } catch (e) {
    return {
      ok: false,
      clients: [],
      error: e instanceof Error ? e.message : 'Display clients list failed',
    };
  }
}

async function commandDisplayClient(clientId, command) {
  const id = String(clientId || '').trim();
  if (!id) return { ok: false, error: 'clientId is required' };
  if (!(await isRunning())) {
    return { ok: false, error: 'Start Offline Show first.' };
  }
  try {
    const data = await requestJson(`/api/kiosk/display-clients/${encodeURIComponent(id)}/command`, {
      method: 'POST',
      body: command && typeof command === 'object' ? command : {},
      timeoutMs: 20000,
    });
    return data && typeof data === 'object' ? { ok: true, ...data } : { ok: false, error: 'Bad response' };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Display client command failed',
    };
  }
}

async function deleteDisplayClient(clientId) {
  const id = String(clientId || '').trim();
  if (!id) return { ok: false, error: 'clientId is required' };
  if (!(await isRunning())) {
    return { ok: false, error: 'Start Offline Show first.' };
  }
  try {
    const data = await requestJson(`/api/kiosk/display-clients/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      timeoutMs: 20000,
    });
    return data && typeof data === 'object' ? { ok: true, ...data } : { ok: false, error: 'Bad response' };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Display client remove failed',
    };
  }
}

module.exports = {
  OFFLINE_SHOW_URL,
  getStatus,
  startOfflineShow,
  stopOfflineShow,
  listEvents,
  isRunning,
  getConnectivity,
  refreshConnectivity,
  runCloudDiagnostics,
  getCloudMode,
  setCloudMode,
  getTokenStatus,
  saveRailwayToken,
  clearRailwayToken,
  applyPendingRailwayToken,
  getStoredTokenStatus,
  syncFromCloud,
  prepareEvents,
  getPptBridgeStatus,
  getVmixBridgeStatus,
  listDisplayClients,
  commandDisplayClient,
  deleteDisplayClient,
};
