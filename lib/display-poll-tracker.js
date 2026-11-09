/**
 * In-memory tracker for noisy display/follower HTTP polls.
 * Powers Admin → Timers → Hot display traffic (IP + event + path + page + station + user).
 */

const { ipKeyGenerator } = require('express-rate-limit');

const WINDOW_MS = 60_000;
const MAX_KEYS = 400;

/**
 * @typedef {{
 *   count: number;
 *   windowStart: number;
 *   lastAt: number;
 *   ip: string;
 *   eventId: string;
 *   kind: string;
 *   path: string;
 *   clientHint: string;
 *   refererHost: string;
 *   refererPath: string;
 *   page: string;
 *   stationLabel: string;
 *   userEmail: string;
 *   userName: string;
 *   userId: string;
 * }} HitEntry
 */

/** @type {Map<string, HitEntry>} */
const hits = new Map();

const ROUTE_PATTERNS = [
  { kind: 'active-timers', re: /^\/api\/active-timers\/([0-9a-f-]{36})(?:\/|$)/i },
  { kind: 'operator-countdown', re: /^\/api\/operator-countdown\/([0-9a-f-]{36})(?:\/|$)/i },
  { kind: 'timer-messages', re: /^\/api\/timer-messages\/([0-9a-f-]{36})(?:\/|$)/i },
  { kind: 'display-sync', re: /^\/api\/display-sync\/([0-9a-f-]{36})$/i },
  { kind: 'powerpoint-playback', re: /^\/api\/powerpoint\/([0-9a-f-]{36})\/playback\/?$/i },
];

const PAGE_FROM_KIND = {
  'powerpoint-playback': 'PPT Launcher',
  'operator-countdown': 'Clock / Full Screen / Op Timer',
  'timer-messages': 'Timer message consumer',
  'display-sync': 'Display sync check',
  'active-timers': 'Active timer poll',
};

function clientIp(req) {
  return ipKeyGenerator(req?.ip || req?.socket?.remoteAddress || '');
}

function requestPath(req) {
  return (req?.originalUrl || req?.url || '').split('?')[0] || '';
}

function header(req, name) {
  const raw = req?.headers?.[name] || req?.headers?.[name.toLowerCase()];
  return typeof raw === 'string' ? raw.trim() : Array.isArray(raw) ? String(raw[0] || '').trim() : '';
}

function refererParts(req) {
  const raw = String(req?.headers?.referer || req?.headers?.referrer || '');
  if (!raw) return { host: '', path: '' };
  try {
    const u = new URL(raw);
    return { host: u.hostname.toLowerCase(), path: u.pathname || '' };
  } catch {
    return { host: '', path: '' };
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

function pageFromRefererPath(pathname) {
  const p = String(pathname || '');
  if (/powerpoint-playback|\/powerpoint\/?$/i.test(p)) return 'PPT Launcher';
  if (/\/dsm-clock/i.test(p)) return 'DSM Clock';
  if (/\/clock/i.test(p)) return 'Clock';
  if (/fullscreen-timer|\/timer/i.test(p)) return 'Full Screen Timer';
  if (/green-room/i.test(p)) return 'Green Room';
  if (/photo-view|\/photo/i.test(p)) return 'Photo View';
  if (/operator-cue|cue-display/i.test(p)) return 'Operator Cue Display';
  if (/mic-manager/i.test(p)) return 'Mic Manager';
  if (/teleprompter/i.test(p)) return 'Teleprompter';
  if (/scripts-follow|\/scripts/i.test(p)) return 'Scripts Follow';
  if (/content-review/i.test(p)) return 'Content Review';
  if (/creative/i.test(p)) return 'Creative ROS';
  if (/run-of-show/i.test(p)) return 'Run of Show';
  return '';
}

function resolvePage(req, kind, refererPath) {
  const fromHeader = header(req, 'x-ros-client-page').slice(0, 64);
  if (fromHeader) return fromHeader;
  const fromRef = pageFromRefererPath(refererPath);
  if (fromRef) return fromRef;
  return PAGE_FROM_KIND[kind] || kind;
}

function resolveUser(req) {
  const auth = req?.auth;
  if (!auth) return { userEmail: '', userName: '', userId: '' };
  const userEmail = String(auth.email || '').trim().slice(0, 120);
  const userName = String(auth.fullName || auth.name || auth.userName || '')
    .trim()
    .slice(0, 80);
  const userId = String(auth.userId || auth.neonUserId || auth.id || '').trim().slice(0, 80);
  return { userEmail, userName, userId };
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
  const ref = refererParts(req);
  const page = resolvePage(req, matched.kind, ref.path);
  const stationLabel = header(req, 'x-ros-display-label').slice(0, 64);
  const { userEmail, userName, userId } = resolveUser(req);
  const key = `${ip}|${matched.eventId}|${matched.kind}|${page}|${stationLabel}|${userEmail}`;
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
      refererHost: ref.host,
      refererPath: ref.path,
      page,
      stationLabel,
      userEmail,
      userName,
      userId,
    };
  }
  entry.count += 1;
  entry.lastAt = now;
  entry.path = pathname;
  entry.clientHint = clientHint(req);
  entry.refererHost = ref.host || entry.refererHost;
  entry.refererPath = ref.path || entry.refererPath;
  entry.page = page || entry.page;
  if (stationLabel) entry.stationLabel = stationLabel;
  if (userEmail) entry.userEmail = userEmail;
  if (userName) entry.userName = userName;
  if (userId) entry.userId = userId;
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
      page: entry.page || null,
      stationLabel: entry.stationLabel || null,
      userEmail: entry.userEmail || null,
      userName: entry.userName || null,
      userId: entry.userId || null,
      count: entry.count,
      perMinute,
      clientHint: entry.clientHint,
      refererHost: entry.refererHost || null,
      refererPath: entry.refererPath || null,
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
