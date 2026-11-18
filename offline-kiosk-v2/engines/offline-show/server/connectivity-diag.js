'use strict';

const https = require('https');
const dns = require('dns').promises;
const { URL } = require('url');
const {
  RAILWAY_HEALTH_URL,
  INTERNET_PROBE_URLS,
  clearConnectivityCache,
  probeConnectivity,
  warmCloudConnectivity,
} = require('./connectivity');
const { cloudLog, readCloudLogTail, logPath, logsDir } = require('./connectivity-log');
const { getCloudMode } = require('./cloud-mode');
const { getRailwayApiTokenStatus } = require('./railway-api-token');

const RAILWAY_DEEP_HEALTH_URL =
  process.env.OFFLINE_RAILWAY_DEEP_HEALTH_URL ||
  (RAILWAY_HEALTH_URL.endsWith('/health')
    ? `${RAILWAY_HEALTH_URL}/deep`
    : 'https://ros-50-production.up.railway.app/health/deep');

function errText(e) {
  if (!e) return 'unknown';
  if (e instanceof Error) {
    const bits = [e.message];
    if (e.code) bits.push(`code=${e.code}`);
    if (e.cause) bits.push(`cause=${errText(e.cause)}`);
    return bits.join(' | ');
  }
  return String(e);
}

async function dnsLookup(hostname) {
  try {
    const all = await dns.lookup(hostname, { all: true });
    return {
      ok: true,
      records: all.map((r) => ({ address: r.address, family: r.family })),
    };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

function httpsGetProbe(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve({ ...payload, latencyMs: Date.now() - started });
    };
    try {
      const req = https.get(
        url,
        {
          timeout: timeoutMs,
          headers: { Accept: 'application/json', 'User-Agent': 'ros-offline-show-diag/1.0' },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8').slice(0, 500);
            let json = null;
            try {
              json = JSON.parse(text);
            } catch {
              /* ignore */
            }
            finish({
              ok: res.statusCode >= 200 && res.statusCode < 400,
              method: 'https.get',
              status: res.statusCode,
              bodyPreview: text.slice(0, 200),
              jsonStatus: json?.status || null,
              dbConnected: json?.dbConnected ?? json?.services?.neon?.connected ?? null,
              error: null,
            });
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        finish({ ok: false, method: 'https.get', error: `timeout after ${timeoutMs}ms` });
      });
      req.on('error', (e) => {
        finish({ ok: false, method: 'https.get', error: errText(e) });
      });
    } catch (e) {
      finish({ ok: false, method: 'https.get', error: errText(e) });
    }
  });
}

async function fetchProbe(url, timeoutMs = 8000) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'ros-offline-show-diag/1.0' },
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* ignore */
    }
    return {
      ok: res.ok || res.status === 204,
      method: 'fetch',
      status: res.status,
      bodyPreview: text.slice(0, 200),
      jsonStatus: json?.status || null,
      dbConnected: json?.dbConnected ?? json?.services?.neon?.connected ?? null,
      latencyMs: Date.now() - started,
      error: null,
    };
  } catch (e) {
    return {
      ok: false,
      method: 'fetch',
      latencyMs: Date.now() - started,
      error: errText(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function diagnoseUrl(url) {
  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    /* keep */
  }
  const dns = await dnsLookup(hostname);
  cloudLog('INFO', `DNS ${hostname}`, dns);
  const [fetchResult, httpsResult] = await Promise.all([fetchProbe(url), httpsGetProbe(url)]);
  cloudLog('INFO', `fetch ${url}`, fetchResult);
  cloudLog('INFO', `https.get ${url}`, httpsResult);
  return { url, hostname, dns, fetch: fetchResult, https: httpsResult };
}

async function runConnectivityDiagnostics(db) {
  clearConnectivityCache();
  const cloud = getCloudMode(db);
  const token = getRailwayApiTokenStatus(db);
  const meta = {
    at: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cloudMode: cloud.mode,
    lanOnly: cloud.lanOnly,
    cloudConnected: cloud.cloudConnected,
    tokenConfigured: token.configured,
    tokenPrefix: token.prefix || null,
    railwayHealthUrl: RAILWAY_HEALTH_URL,
    railwayDeepHealthUrl: RAILWAY_DEEP_HEALTH_URL,
    internetProbeUrls: INTERNET_PROBE_URLS,
    logPath: logPath(),
    logsDir: logsDir(),
  };
  cloudLog('INFO', '=== Cloud diagnostics start ===', meta);

  if (cloud.lanOnly) {
    cloudLog(
      'WARN',
      'Cloud probes are SKIPPED while mode is LAN only — turn Cloud on, then re-run diagnostics'
    );
  }

  const internetUrl = INTERNET_PROBE_URLS[0] || 'https://cloudflare.com/cdn-cgi/trace';
  const probes = {
    internet: await diagnoseUrl(internetUrl),
    railwayHealth: await diagnoseUrl(RAILWAY_HEALTH_URL),
    railwayDeep: await diagnoseUrl(RAILWAY_DEEP_HEALTH_URL),
  };

  const warmup = cloud.cloudConnected
    ? await warmCloudConnectivity({ attempts: 3, delayMs: 300 })
    : { skipped: true, reason: 'not cloud-connected' };
  cloudLog('INFO', 'warmup', warmup);

  const connectivity = await probeConnectivity(db);
  cloudLog('INFO', 'probeConnectivity summary', {
    internet: connectivity.internet,
    railway: connectivity.railway,
    neon: connectivity.neon,
    localLan: connectivity.localLan,
    lanOnly: connectivity.lanOnly,
  });
  cloudLog('INFO', '=== Cloud diagnostics end ===');

  const log = readCloudLogTail();
  return {
    ok: true,
    meta,
    probes,
    warmup,
    connectivity,
    log,
    hint:
      cloud.lanOnly
        ? 'Mode is LAN only — Railway/Neon pills stay skipped until Cloud on.'
        : probes.railwayHealth?.fetch?.ok || probes.railwayHealth?.https?.ok
          ? 'Node can reach /health. If pills still fail, check Cloud mode + Recheck.'
          : 'Node cannot reach Railway /health (TLS/DNS/firewall). Browser can still work with different certs/proxy.',
  };
}

module.exports = {
  runConnectivityDiagnostics,
  diagnoseUrl,
  RAILWAY_DEEP_HEALTH_URL,
};
