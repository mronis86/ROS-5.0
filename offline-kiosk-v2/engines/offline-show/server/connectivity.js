'use strict';

const { getCloudMode } = require('./cloud-mode');
const { getRailwayApiToken, getRailwayApiTokenStatus } = require('./railway-api-token');
const { probeRailwayTokenWriteAccess } = require('./railway-client');
const { cloudLog } = require('./connectivity-log');

const RAILWAY_HEALTH_URL =
  process.env.OFFLINE_RAILWAY_HEALTH_URL || 'https://ros-50-production.up.railway.app/health';
const RAILWAY_DEEP_HEALTH_URL =
  process.env.OFFLINE_RAILWAY_DEEP_HEALTH_URL ||
  (RAILWAY_HEALTH_URL.endsWith('/health')
    ? `${RAILWAY_HEALTH_URL}/deep`
    : 'https://ros-50-production.up.railway.app/health/deep');
const INTERNET_PROBE_URLS = (
  process.env.OFFLINE_INTERNET_PROBE_URL ||
  'https://www.msftconnecttest.com/connecttest.txt,https://cloudflare.com/cdn-cgi/trace,https://www.gstatic.com/generate_204'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
/** Default 8s — 4s was too aggressive on cold TLS / distant show PCs. */
const PROBE_TIMEOUT_MS = Number(process.env.OFFLINE_PROBE_TIMEOUT_MS || 8000);
const CACHE_MS = Number(process.env.OFFLINE_CONNECTIVITY_CACHE_MS || 8000);
/** Deep Neon probe wakes the DB — cache longer than the live Railway check. */
const NEON_CACHE_MS = Number(process.env.OFFLINE_NEON_PROBE_CACHE_MS || 60000);
const WRITE_PROBE_CACHE_MS = Number(process.env.OFFLINE_TOKEN_WRITE_PROBE_CACHE_MS || 60000);

let cache = { at: 0, mode: null, data: null };
let writeProbeCache = { at: 0, tokenPrefix: null, result: null };
let neonProbeCache = { at: 0, neon: null };

function clearConnectivityCache() {
  cache = { at: 0, mode: null, data: null };
  writeProbeCache = { at: 0, tokenPrefix: null, result: null };
  neonProbeCache = { at: 0, neon: null };
}

function skippedPill(label, reason) {
  return {
    ok: false,
    skipped: true,
    label,
    latencyMs: undefined,
    error: null,
    status: 'disabled',
    reason,
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = e && typeof e === 'object' && 'code' in e ? e.code : null;
    cloudLog('WARN', `fetch fail ${url}`, { error: msg, code, timeoutMs: PROBE_TIMEOUT_MS });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function probeInternet() {
  const started = Date.now();
  const errors = [];
  for (const url of INTERNET_PROBE_URLS) {
    try {
      const res = await fetchWithTimeout(url, { method: 'GET' });
      if (res.ok || res.status === 204) {
        return {
          ok: true,
          label: 'Internet',
          latencyMs: Date.now() - started,
          error: null,
        };
      }
      errors.push(`${url}: HTTP ${res.status}`);
    } catch (e) {
      errors.push(`${url}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }
  return {
    ok: false,
    label: 'Internet',
    latencyMs: Date.now() - started,
    error: errors[0] || 'Unreachable',
  };
}

async function probeRailwayAndNeon() {
  const started = Date.now();
  // /health is liveness-only (no Neon) so UptimeRobot does not wake the DB.
  // Neon readiness comes from /health/deep, cached separately.
  try {
    const res = await fetchWithTimeout(RAILWAY_HEALTH_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const body = await res.json().catch(() => ({}));
    const railwayOk = res.ok && body.status === 'healthy';
    const railway = {
      ok: railwayOk,
      label: 'Railway',
      latencyMs: Date.now() - started,
      status: body.status || (res.ok ? 'unknown' : 'error'),
      error: railwayOk ? null : body.error || `HTTP ${res.status}`,
    };

    const now = Date.now();
    if (neonProbeCache.neon && now - neonProbeCache.at < NEON_CACHE_MS) {
      return { railway, neon: neonProbeCache.neon };
    }

    let neon;
    try {
      const deepStarted = Date.now();
      const deepRes = await fetchWithTimeout(RAILWAY_DEEP_HEALTH_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const deepBody = await deepRes.json().catch(() => ({}));
      const neonOk =
        deepBody.dbConnected === true || deepBody.services?.neon?.connected === true;
      neon = {
        ok: neonOk,
        label: 'Neon',
        latencyMs: Date.now() - deepStarted,
        dbName: deepBody.services?.neon?.dbName || null,
        error: neonOk ? null : deepBody.error || 'Database not connected',
      };
    } catch (e) {
      neon = {
        ok: false,
        label: 'Neon',
        latencyMs: Date.now() - started,
        dbName: null,
        error: e instanceof Error ? e.message : 'Unreachable',
      };
    }
    neonProbeCache = { at: now, neon };
    return { railway, neon };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unreachable';
    return {
      railway: {
        ok: false,
        label: 'Railway',
        latencyMs: Date.now() - started,
        status: 'error',
        error: msg,
      },
      neon: {
        ok: false,
        label: 'Neon',
        latencyMs: Date.now() - started,
        dbName: null,
        error: msg,
      },
    };
  }
}

function probeLocalLan(db) {
  try {
    db.prepare('SELECT 1').get();
    return {
      ok: true,
      label: 'Local LAN',
      db: 'sqlite',
      error: null,
    };
  } catch (e) {
    return {
      ok: false,
      label: 'Local LAN',
      db: 'sqlite',
      error: e instanceof Error ? e.message : 'SQLite error',
    };
  }
}

async function probeRailwayReachable() {
  const started = Date.now();
  const res = await fetchWithTimeout(RAILWAY_HEALTH_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Railway unreachable (HTTP ${res.status})`);
  }
  const body = await res.json().catch(() => ({}));
  if (body.status && body.status !== 'healthy') {
    throw new Error(body.error || 'Railway health check failed');
  }
  return { latencyMs: Date.now() - started, body };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Warm TLS + Railway/Neon probes with retries.
 * First HTTPS call after Offline Show start often fails or stalls on Windows
 * (TLS session / cold Railway). Call after flipping Cloud on, then refresh pills.
 */
async function warmCloudConnectivity({ attempts = 4, delayMs = 400 } = {}) {
  clearConnectivityCache();
  const errors = [];
  let railwayOk = false;
  let neonOk = false;

  for (let i = 0; i < Math.max(1, attempts); i++) {
    try {
      await probeRailwayReachable();
      railwayOk = true;
    } catch (e) {
      errors.push(`railway[${i + 1}]: ${e instanceof Error ? e.message : 'fail'}`);
    }

    try {
      const deepRes = await fetchWithTimeout(RAILWAY_DEEP_HEALTH_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const deepBody = await deepRes.json().catch(() => ({}));
      neonOk =
        deepBody.dbConnected === true || deepBody.services?.neon?.connected === true;
      if (!neonOk) {
        errors.push(
          `neon[${i + 1}]: ${deepBody.error || `HTTP ${deepRes.status}` || 'not connected'}`
        );
      }
    } catch (e) {
      errors.push(`neon[${i + 1}]: ${e instanceof Error ? e.message : 'fail'}`);
    }

    if (railwayOk && neonOk) {
      clearConnectivityCache();
      return {
        ok: true,
        railwayOk: true,
        neonOk: true,
        attempts: i + 1,
        error: null,
      };
    }

    if (i < attempts - 1) await sleep(delayMs * (i + 1));
    clearConnectivityCache();
  }

  return {
    ok: railwayOk,
    railwayOk,
    neonOk,
    attempts,
    error: errors[errors.length - 1] || (railwayOk ? 'Neon not ready' : 'Railway unreachable'),
  };
}

async function probeConnectivity(db) {
  const cloud = getCloudMode(db);
  const now = Date.now();
  if (cache.data && cache.mode === cloud.mode && now - cache.at < CACHE_MS) {
    return { ...cache.data, cached: true };
  }

  const localLan = probeLocalLan(db);
  let internet;
  let railway;
  let neon;

  if (cloud.lanOnly) {
    const reason = 'LAN only — cloud connectivity disabled on show server';
    cloudLog('WARN', 'probeConnectivity skipped cloud pills', { mode: cloud.mode, reason });
    internet = skippedPill('Internet', reason);
    railway = skippedPill('Railway', reason);
    neon = skippedPill('Neon', reason);
  } else {
    cloudLog('INFO', 'probeConnectivity cloud probes', {
      railwayHealth: RAILWAY_HEALTH_URL,
      railwayDeep: RAILWAY_DEEP_HEALTH_URL,
    });
    const [inet, cloudProbes] = await Promise.all([probeInternet(), probeRailwayAndNeon()]);
    internet = inet;
    railway = cloudProbes.railway;
    neon = cloudProbes.neon;
    cloudLog('INFO', 'probeConnectivity results', {
      internet: { ok: internet.ok, error: internet.error, latencyMs: internet.latencyMs },
      railway: {
        ok: railway.ok,
        error: railway.error,
        status: railway.status,
        latencyMs: railway.latencyMs,
      },
      neon: { ok: neon.ok, error: neon.error, latencyMs: neon.latencyMs },
    });
  }

  const tokenStatus = getRailwayApiTokenStatus(db);
  let railwayApiToken = { ...tokenStatus, canWrite: null, writeError: null };
  if (tokenStatus.configured && cloud.cloudConnected) {
    const token = getRailwayApiToken(db);
    const prefix = tokenStatus.prefix;
    const nowMs = Date.now();
    let writeProbe = writeProbeCache.result;
    if (
      !writeProbe ||
      writeProbeCache.tokenPrefix !== prefix ||
      nowMs - writeProbeCache.at >= WRITE_PROBE_CACHE_MS
    ) {
      writeProbe = await probeRailwayTokenWriteAccess(token);
      writeProbeCache = { at: nowMs, tokenPrefix: prefix, result: writeProbe };
    }
    railwayApiToken = {
      ...tokenStatus,
      canWrite: writeProbe.canWrite === true,
      writeError: writeProbe.canWrite ? null : writeProbe.error || 'Write check failed',
    };
  }

  const data = {
    app: 'offline-show',
    cloudMode: cloud.mode,
    lanOnly: cloud.lanOnly,
    cloudConnected: cloud.cloudConnected,
    cloudModeUpdatedAt: cloud.updatedAt,
    railwayApiToken,
    timestamp: new Date().toISOString(),
    cached: false,
    internet,
    railway,
    neon,
    localLan,
  };

  cache = { at: now, mode: cloud.mode, data };
  return data;
}

module.exports = {
  probeConnectivity,
  probeRailwayReachable,
  warmCloudConnectivity,
  clearConnectivityCache,
  RAILWAY_HEALTH_URL,
  INTERNET_PROBE_URLS,
};
