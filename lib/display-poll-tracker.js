/**
 * In-memory tracker for noisy display/follower HTTP polls.
 * Powers Admin → Timers → Hot display traffic (IP + event + path kind).
 */

const { ipKeyGenerator } = require('express-rate-limit');

const WINDOW_MS = 60_000;
const MAX_KEYS = 400;

/** @type {Map<string, { count: number; windowStart: number; lastAt: number; ip: string; eventId: string; kind: string; path: string; clientHint: string; refererHost: string }>} */
const hits = new Map();

const ROUTE_PATTERNS = [
  { kind: 'active-timers', re: /^\/api\/active-timers\/([0-9a-f-]{36})(?:\/|$)/i },
  { kind: 'operator-countdown', re: /^\/api\/operator-countdown\/([0-9a-f-]{36})(?:\/|$)/i },
  { kind: 'timer-messages', re: /^\/api\/timer-messages\/([0-9a-f-]{36})(?:\/|$)/i },
  { kind: 'display-sync', re: /^\/api\/display-sync\/([0-9a-f-]{36})$/i },
  { kind: 'powerpoint-playback', re: /^\/api\/powerpoint\/([0-9a-f-]{36})\/playback\/?$/i },
];

function clientIp(req) {
  return ipKeyGenerator(req?.ip || req?.socket?.remoteAddress || '');
}

function requestPath(req) {
  return (req?.originalUrl || req?.url || '').split('?')[0] || '';
}

function refererHost(req) {
  const raw = String(req?.headers?.referer || req?.headers?.referrer || '');
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function clientHint(req) {
  const ua = String(req?.headers?.['user-agent'] || '');
  if (/OBS\//i.test(ua)) return 'OBS';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
  return ua ? ua.slice(0, 48) : 'unknown';
}

function matchDisplayPoll(pathname) {
  for (const row of ROUTE_PATTERNS) {
    const m = pathname.match(row.re);
    if (m) return { kind: row.kind, eventId: String(m[1]).toLowerCase() };
  }
  return null;
}

function prune(now = Date.now()) {
  for (const [key, entry] of hits) {
    if (!entry || now - entry.windowStart > WINDOW_MS * 2) hits.delete(key);
  }
  if (hits.size <= MAX_KEYS) return;
  const sorted = [...hits.entries()].sort((a, b) => (a[1]?.lastAt || 0) - (b[1]?.lastAt || 0));
  const drop = hits.size - MAX_KEYS;
  for (let i = 0; i < drop; i++) hits.delete(sorted[i][0]);
}

function recordDisplayPoll(req) {
  if ((req?.method || 'GET').toUpperCase() !== 'GET') return;
  const pathname = requestPath(req);
  const matched = matchDisplayPoll(pathname);
  if (!matched) return;

  const now = Date.now();
  prune(now);
  const ip = clientIp(req);
  const key = `${ip}|${matched.eventId}|${matched.kind}`;
  let entry = hits.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = {
      count: 0,
      windowStart: now,
      lastAt: now,
      ip,
      eventId: matched.eventId,
      kind: matched.kind,
      path: pathname,
      clientHint: clientHint(req),
      refererHost: refererHost(req),
    };
  }
  entry.count += 1;
  entry.lastAt = now;
  entry.path = pathname;
  entry.clientHint = clientHint(req);
  entry.refererHost = refererHost(req) || entry.refererHost;
  hits.set(key, entry);
}

function createDisplayPollTrackerMiddleware() {
  return function displayPollTrackerMiddleware(req, _res, next) {
    try {
      recordDisplayPoll(req);
    } catch {
      /* never block requests */
    }
    next();
  };
}

function snapshotDisplayPollTraffic({ minCount = 3, limit = 40 } = {}) {
  const now = Date.now();
  prune(now);
  const rows = [];
  for (const entry of hits.values()) {
    if (!entry) continue;
    const ageMs = now - entry.windowStart;
    if (ageMs > WINDOW_MS * 1.5) continue;
    const windowSec = Math.max(1, Math.min(WINDOW_MS, ageMs) / 1000);
    const perMinute = Math.round((entry.count / windowSec) * 60);
    if (entry.count < minCount && perMinute < 6) continue;
    rows.push({
      ip: entry.ip,
      eventId: entry.eventId,
      kind: entry.kind,
      path: entry.path,
      count: entry.count,
      perMinute,
      clientHint: entry.clientHint,
      refererHost: entry.refererHost || null,
      lastAt: new Date(entry.lastAt).toISOString(),
      windowSeconds: Math.round(windowSec),
    });
  }
  rows.sort((a, b) => b.perMinute - a.perMinute || b.count - a.count);
  return rows.slice(0, limit);
}

module.exports = {
  createDisplayPollTrackerMiddleware,
  snapshotDisplayPollTraffic,
  recordDisplayPoll,
};
