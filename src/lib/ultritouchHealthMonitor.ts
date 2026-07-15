import { getApiBaseUrl } from '../services/api-client';
import type {
  CloudHealthSnapshot,
  HealthLogEntry,
  HealthLogLevel,
  HealthMonitorMode,
  HealthMonitorSnapshot,
  HealthMonitorTile,
  OfflineHealthSnapshot,
  OverallHealthState,
  MonitorFeedSnapshot,
  StatuspageSnapshot,
} from '../types/ultritouchHealthMonitor';

const OFFLINE_PILL_ACCENTS: Record<string, HealthMonitorTile['accent']> = {
  internet: 'sky',
  railway: 'violet',
  neon: 'teal',
  localLan: 'emerald',
};

const STATUSPAGE_SOURCES = {
  netlify: {
    url: 'https://www.netlifystatus.com/api/v2/summary.json',
    highlightNames: [
      'Standard Edge Network',
      'High-Performance Edge Network',
      'API',
      'Build Pipeline',
      'Netlify Functions',
    ],
  },
  resend: {
    url: 'https://resend-status.com/api/v2/summary.json',
    highlightNames: ['API', 'SMTP', 'Dashboard', 'Webhooks'],
  },
} as const;

export function parseHealthMonitorMode(raw: string | null): HealthMonitorMode {
  return raw === 'offline' ? 'offline' : 'cloud';
}

export function parsePollIntervalMs(raw: string | null): number {
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 5) return 30_000;
  return Math.min(seconds, 300) * 1000;
}

function mapStatuspageIndicator(indicator: string | undefined): StatuspageSnapshot['indicator'] {
  if (indicator === 'none' || indicator === 'minor' || indicator === 'major' || indicator === 'critical') {
    return indicator;
  }
  return 'unknown';
}

export function parseStatuspageSummary(
  data: any,
  highlightNames: readonly string[] = []
): StatuspageSnapshot {
  const indicator = mapStatuspageIndicator(data?.status?.indicator);
  const description =
    typeof data?.status?.description === 'string' && data.status.description
      ? data.status.description
      : indicator === 'none'
        ? 'All Systems Operational'
        : 'Status unavailable';
  const components: any[] = Array.isArray(data?.components) ? data.components : [];
  const highlight =
    highlightNames.map((name) => components.find((c) => c && !c.group && c.name === name)).find(Boolean) ||
    components.find((c) => c && !c.group);

  return {
    ok: indicator === 'none',
    indicator,
    description,
    updatedAt: typeof data?.page?.updated_at === 'string' ? data.page.updated_at : undefined,
    highlightName: highlight?.name,
    highlightStatus: highlight?.status,
  };
}

/** @deprecated Prefer parseStatuspageSummary */
export function parseNetlifySummary(data: any): StatuspageSnapshot {
  return parseStatuspageSummary(data, STATUSPAGE_SOURCES.netlify.highlightNames);
}

async function fetchStatuspage(
  source: keyof typeof STATUSPAGE_SOURCES,
  label: string
): Promise<StatuspageSnapshot> {
  const { url, highlightNames } = STATUSPAGE_SOURCES[source];
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return {
        ok: false,
        indicator: 'unknown',
        description: `${label} status HTTP ${res.status}`,
        error: `HTTP ${res.status}`,
      };
    }
    const data = await res.json();
    return parseStatuspageSummary(data, highlightNames);
  } catch (e) {
    return {
      ok: false,
      indicator: 'unknown',
      description: `${label} status unreachable`,
      error: e instanceof Error ? e.message : 'Unreachable',
    };
  }
}

export async function fetchNetlifyStatus(): Promise<StatuspageSnapshot> {
  return fetchStatuspage('netlify', 'Netlify');
}

export async function fetchResendStatus(): Promise<StatuspageSnapshot> {
  return fetchStatuspage('resend', 'Resend');
}

function levelFromStatuspage(status?: StatuspageSnapshot): HealthMonitorTile['level'] {
  if (!status) return 'fail';
  if (status.indicator === 'none') return 'ok';
  if (status.indicator === 'minor') return 'alert';
  return 'fail';
}

function statuspageTile(
  id: 'netlify' | 'resend',
  label: string,
  subtitle: string,
  accent: HealthMonitorTile['accent'],
  status?: StatuspageSnapshot
): HealthMonitorTile {
  if (!status) {
    return {
      id,
      label,
      subtitle,
      ok: false,
      level: 'fail',
      skipped: true,
      detail: 'Not checked',
      accent,
    };
  }
  const level = levelFromStatuspage(status);
  const detail =
    status.highlightName && status.highlightStatus
      ? `${status.highlightName}: ${String(status.highlightStatus).replace(/_/g, ' ')}`
      : status.description;
  return {
    id,
    label,
    subtitle,
    ok: level === 'ok',
    level,
    detail,
    accent,
  };
}

function netlifyTile(netlify?: StatuspageSnapshot): HealthMonitorTile {
  return statuspageTile('netlify', 'Netlify', 'CDN / hosting', 'sky', netlify);
}

function resendTile(resend?: StatuspageSnapshot): HealthMonitorTile {
  return statuspageTile('resend', 'Resend', 'Email', 'rose', resend);
}

export async function fetchHealthMonitorSnapshot(mode: HealthMonitorMode): Promise<HealthMonitorSnapshot> {
  if (mode === 'offline') {
    const [res, netlify, resend] = await Promise.all([
      fetch('/api/connectivity-status', { cache: 'no-store' }),
      fetchNetlifyStatus(),
      fetchResendStatus(),
    ]);
    if (!res.ok) {
      throw new Error(`Connectivity check failed (HTTP ${res.status})`);
    }
    const data = (await res.json()) as OfflineHealthSnapshot;
    return { ...data, kind: 'offline', netlify, resend };
  }

  const base = getApiBaseUrl();
  const [res, netlify, resend] = await Promise.all([
    fetch(`${base}/health`, { cache: 'no-store' }),
    fetchNetlifyStatus(),
    fetchResendStatus(),
  ]);
  const data = (await res.json().catch(() => ({}))) as CloudHealthSnapshot;
  if (!res.ok) {
    throw new Error(data.error || `Health check failed (HTTP ${res.status})`);
  }
  return { ...data, kind: 'cloud', netlify, resend };
}

export function tilesFromSnapshot(snapshot: HealthMonitorSnapshot): HealthMonitorTile[] {
  if (snapshot.kind === 'offline') {
    const entries: { key: keyof Pick<OfflineHealthSnapshot, 'internet' | 'railway' | 'neon' | 'localLan'>; subtitle: string }[] = [
      { key: 'internet', subtitle: 'WAN probe' },
      { key: 'railway', subtitle: 'Hosted API' },
      { key: 'neon', subtitle: 'Cloud database' },
      { key: 'localLan', subtitle: 'Show SQLite' },
    ];
    const base = entries.map(({ key, subtitle }) => {
      const pill = snapshot[key];
      let detail = pill.error || pill.reason || pill.db || pill.dbName || pill.status || '';
      if (pill.skipped) detail = pill.reason || 'Skipped';
      else if (pill.ok && pill.latencyMs != null) detail = `${pill.latencyMs} ms`;
      else if (pill.ok && pill.db) detail = pill.db;
      else if (pill.ok && pill.dbName) detail = pill.dbName;
      else if (pill.ok) detail = 'OK';
      const level: HealthMonitorTile['level'] = pill.skipped ? 'alert' : pill.ok ? 'ok' : 'fail';
      return {
        id: key,
        label: pill.label,
        subtitle,
        ok: level === 'ok',
        level,
        skipped: pill.skipped,
        detail,
        latencyMs: pill.latencyMs,
        accent: OFFLINE_PILL_ACCENTS[key] ?? 'sky',
      };
    });
    // Prefer vendor status tiles over WAN when available (keep 4–5 cards)
    const vendorTiles = [
      snapshot.netlify ? netlifyTile(snapshot.netlify) : null,
      snapshot.resend ? resendTile(snapshot.resend) : null,
    ].filter(Boolean) as HealthMonitorTile[];
    if (vendorTiles.length > 0) {
      return [...vendorTiles, ...base.filter((t) => t.id !== 'internet')].slice(0, 5);
    }
    return base;
  }

  const services = snapshot.services ?? {};
  const upstash = services.upstash;
  // Prefer live `connected` from /health ping; fall back to configured for older API builds
  const upstashLive = typeof upstash?.connected === 'boolean';
  const upstashConnected = upstashLive ? !!upstash.connected : !!upstash?.configured;
  let upstashLevel: HealthMonitorTile['level'] = 'fail';
  let upstashDetail = 'Not configured';
  if (upstash?.configured === false) {
    upstashLevel = 'alert';
    upstashDetail = 'Not configured';
  } else if (upstashConnected && upstash?.latencyMs != null && upstash.latencyMs >= 400) {
    upstashLevel = 'alert';
    upstashDetail = `${upstash.latencyMs} ms (slow)`;
  } else if (upstashConnected) {
    upstashLevel = 'ok';
    if (upstash?.latencyMs != null) upstashDetail = `${upstash.latencyMs} ms`;
    else if (upstashLive) upstashDetail = 'PONG';
    else upstashDetail = 'Configured';
  } else if (upstash?.error) {
    upstashDetail = upstash.error;
  } else if (upstash?.configured) {
    upstashDetail = 'Unreachable';
  }

  const neonOk = !!services.neon?.connected;
  const railwayOk = !!services.railway?.connected;

  return [
    {
      id: 'neon',
      label: 'Neon',
      subtitle: 'PostgreSQL',
      ok: neonOk,
      level: neonOk ? 'ok' : 'fail',
      detail: services.neon?.dbName || (neonOk ? 'Connected' : 'Disconnected'),
      accent: 'teal',
    },
    {
      id: 'railway',
      label: 'Railway',
      subtitle: 'API host',
      ok: railwayOk,
      level: railwayOk ? 'ok' : 'fail',
      detail: services.railway?.env || (railwayOk ? 'Online' : 'Offline'),
      accent: 'violet',
    },
    {
      id: 'upstash',
      label: 'Upstash',
      subtitle: 'Redis / KV',
      ok: upstashLevel === 'ok',
      level: upstashLevel,
      skipped: upstash?.configured === false,
      detail: upstashDetail,
      latencyMs: upstash?.latencyMs,
      accent: 'amber',
    },
    netlifyTile(snapshot.netlify),
    resendTile(snapshot.resend),
  ];
}

export function deriveOverallState(
  snapshot: HealthMonitorSnapshot | null,
  error: string | null,
  loading: boolean
): OverallHealthState {
  if (loading && !snapshot) return 'loading';
  if (error && !snapshot) return 'down';

  if (!snapshot) return 'down';

  if (snapshot.kind === 'offline') {
    const pills = [snapshot.internet, snapshot.railway, snapshot.neon, snapshot.localLan];
    const active = pills.filter((p) => !p.skipped);
    const netlifyLevel = levelFromStatuspage(snapshot.netlify);
    const resendLevel = levelFromStatuspage(snapshot.resend);
    const vendorAlert = netlifyLevel === 'alert' || resendLevel === 'alert';
    const vendorFail = netlifyLevel === 'fail' || resendLevel === 'fail';
    if (active.length === 0) {
      if (vendorFail) return 'down';
      if (vendorAlert) return 'degraded';
      return snapshot.localLan.ok ? 'healthy' : 'down';
    }
    const failed = active.filter((p) => !p.ok);
    if (failed.length === 0 && !vendorFail && !vendorAlert) return 'healthy';
    if (failed.length === active.length && vendorFail) return 'down';
    if (failed.length === active.length) return 'down';
    return 'degraded';
  }

  const neonOk = !!snapshot.services?.neon?.connected;
  const railwayOk = !!snapshot.services?.railway?.connected;
  const upstash = snapshot.services?.upstash;
  const upstashConfigured = upstash?.configured !== false;
  const upstashOk =
    !upstashConfigured ||
    (typeof upstash?.connected === 'boolean' ? upstash.connected : !!upstash?.configured);
  const netlifyLevel = levelFromStatuspage(snapshot.netlify);
  const resendLevel = levelFromStatuspage(snapshot.resend);
  const vendorAlert = netlifyLevel === 'alert' || resendLevel === 'alert';
  const vendorFail = netlifyLevel === 'fail' || resendLevel === 'fail';
  if (
    snapshot.status === 'healthy' &&
    neonOk &&
    railwayOk &&
    upstashOk &&
    netlifyLevel === 'ok' &&
    resendLevel === 'ok'
  ) {
    return 'healthy';
  }
  if (railwayOk || neonOk) {
    if (vendorFail && !neonOk && !railwayOk) return 'down';
    if (vendorAlert || vendorFail || !upstashOk) return 'degraded';
    return 'degraded';
  }
  return 'down';
}

export function healthScorePercent(state: OverallHealthState, tiles: HealthMonitorTile[]): number {
  if (state === 'loading') return 0;
  const active = tiles.filter((t) => !t.skipped || t.level === 'alert');
  if (active.length === 0) return state === 'healthy' ? 100 : 0;
  const score = active.reduce((sum, t) => {
    if (t.level === 'ok') return sum + 1;
    if (t.level === 'alert') return sum + 0.5;
    return sum;
  }, 0);
  return Math.round((score / active.length) * 100);
}

export function formatUptime(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

export function shortApiHost(mode: HealthMonitorMode): string {
  if (mode === 'offline') {
    return typeof window !== 'undefined' ? window.location.host : 'offline-show';
  }
  try {
    return new URL(getApiBaseUrl()).host;
  } catch {
    return getApiBaseUrl();
  }
}

export function modeLabel(mode: HealthMonitorMode, snapshot: HealthMonitorSnapshot | null): string {
  if (mode === 'cloud') return 'Cloud';
  if (snapshot?.kind === 'offline') {
    return snapshot.lanOnly ? 'LAN only' : 'Cloud connected';
  }
  return 'Offline show';
}

export function railwayUptimeSeconds(snapshot: HealthMonitorSnapshot | null): number | undefined {
  if (snapshot?.kind !== 'cloud') return undefined;
  return snapshot.services?.railway?.uptimeSeconds;
}

function logLevelForTile(tile: HealthMonitorTile): HealthLogLevel {
  if (tile.skipped && tile.level === 'alert') return 'warn';
  if (tile.level === 'ok') return 'ok';
  if (tile.level === 'alert') return 'warn';
  return 'error';
}

function overallLevel(state: OverallHealthState): HealthLogLevel {
  if (state === 'healthy') return 'ok';
  if (state === 'degraded') return 'warn';
  if (state === 'loading') return 'info';
  return 'error';
}

let logIdCounter = 0;

function makeLogEntry(
  level: HealthLogLevel,
  message: string,
  opts?: { serviceId?: string; detail?: string }
): HealthLogEntry {
  logIdCounter += 1;
  return {
    id: `log-${Date.now()}-${logIdCounter}`,
    at: new Date().toISOString(),
    level,
    serviceId: opts?.serviceId,
    message,
    detail: opts?.detail,
  };
}

export function buildHealthLogUpdates(
  prevTiles: HealthMonitorTile[] | null,
  nextTiles: HealthMonitorTile[],
  prevOverall: OverallHealthState | null,
  nextOverall: OverallHealthState,
  error: string | null,
  opts?: { manual?: boolean; firstLoad?: boolean }
): HealthLogEntry[] {
  const entries: HealthLogEntry[] = [];

  if (opts?.firstLoad) {
    entries.push(
      makeLogEntry('info', 'Monitor started', {
        detail: opts.manual ? 'Manual refresh' : 'Auto poll active',
      })
    );
  } else if (opts?.manual) {
    entries.push(makeLogEntry('info', 'Manual refresh'));
  }

  if (error) {
    entries.push(makeLogEntry('error', 'Health check failed', { detail: error }));
  }

  if (prevOverall && prevOverall !== nextOverall && nextOverall !== 'loading') {
    entries.push(
      makeLogEntry(overallLevel(nextOverall), `Overall: ${prevOverall} → ${nextOverall}`)
    );
  }

  if (prevTiles) {
    for (const next of nextTiles) {
      const prev = prevTiles.find((t) => t.id === next.id);
      if (!prev) continue;
      if (prev.level === next.level && prev.detail === next.detail) continue;
      const level = logLevelForTile(next);
      const labelFor = (t: HealthMonitorTile) =>
        t.skipped && t.level !== 'alert'
          ? 'N/A'
          : t.level === 'ok'
            ? 'OK'
            : t.level === 'alert'
              ? 'ALERT'
              : 'FAIL';
      entries.push(
        makeLogEntry(level, `${next.label}: ${labelFor(prev)} → ${labelFor(next)}`, {
          serviceId: next.id,
          detail: next.detail || prev.detail,
        })
      );
    }
  } else if (!opts?.firstLoad && !error && nextTiles.length > 0) {
    entries.push(
      makeLogEntry('ok', 'Snapshot received', {
        detail: `${nextTiles.filter((t) => t.ok && !t.skipped).length}/${nextTiles.filter((t) => !t.skipped).length} services OK`,
      })
    );
  }

  if (entries.length === 0 && !error && opts?.manual) {
    entries.push(makeLogEntry('ok', 'No changes since last check'));
  }

  return entries;
}

export function prependLogEntries(
  existing: HealthLogEntry[],
  incoming: HealthLogEntry[],
  max = 80
): HealthLogEntry[] {
  return [...incoming, ...existing].slice(0, max);
}

export function filterLogEntries(
  entries: HealthLogEntry[],
  filter: 'all' | 'alerts' | 'selected',
  selectedServiceId: string | null
): HealthLogEntry[] {
  if (filter === 'alerts') {
    return entries.filter((e) => e.level === 'warn' || e.level === 'error');
  }
  if (filter === 'selected' && selectedServiceId) {
    return entries.filter((e) => e.serviceId === selectedServiceId);
  }
  if (selectedServiceId && filter === 'all') {
    return entries.filter((e) => !e.serviceId || e.serviceId === selectedServiceId);
  }
  return entries;
}

export function tileDetailLines(
  tile: HealthMonitorTile,
  snapshot: HealthMonitorSnapshot | null
): string[] {
  const lines = [
    `Status: ${
      tile.skipped && tile.level !== 'alert'
        ? 'Skipped'
        : tile.level === 'ok'
          ? 'OK'
          : tile.level === 'alert'
            ? 'ALERT'
            : 'FAIL'
    }`,
  ];
  if (tile.detail) lines.push(`Detail: ${tile.detail}`);
  if (tile.latencyMs != null) lines.push(`Latency: ${tile.latencyMs} ms`);
  if (!snapshot) return lines;

  if (tile.id === 'netlify' && snapshot.netlify) {
    lines.push(`Indicator: ${snapshot.netlify.indicator}`);
    lines.push(`Summary: ${snapshot.netlify.description}`);
    if (snapshot.netlify.highlightName) {
      lines.push(
        `${snapshot.netlify.highlightName}: ${String(snapshot.netlify.highlightStatus || '—').replace(/_/g, ' ')}`
      );
    }
    if (snapshot.netlify.updatedAt) lines.push(`Updated: ${snapshot.netlify.updatedAt}`);
    if (snapshot.netlify.error) lines.push(`Error: ${snapshot.netlify.error}`);
    return lines;
  }

  if (tile.id === 'resend' && snapshot.resend) {
    lines.push(`Indicator: ${snapshot.resend.indicator}`);
    lines.push(`Summary: ${snapshot.resend.description}`);
    if (snapshot.resend.highlightName) {
      lines.push(
        `${snapshot.resend.highlightName}: ${String(snapshot.resend.highlightStatus || '—').replace(/_/g, ' ')}`
      );
    }
    if (snapshot.resend.updatedAt) lines.push(`Updated: ${snapshot.resend.updatedAt}`);
    if (snapshot.resend.error) lines.push(`Error: ${snapshot.resend.error}`);
    return lines;
  }

  if (snapshot.kind === 'cloud') {
    const svc = snapshot.services?.[tile.id as keyof typeof snapshot.services];
    if (svc && 'nodeVersion' in svc && svc.nodeVersion) lines.push(`Node: ${svc.nodeVersion}`);
    if (svc && 'uptimeSeconds' in svc && svc.uptimeSeconds != null) {
      lines.push(`Uptime: ${formatUptime(svc.uptimeSeconds)}`);
    }
    if (svc && 'env' in svc && svc.env) lines.push(`Env: ${svc.env}`);
    if (svc && 'dbName' in svc && svc.dbName) lines.push(`Database: ${svc.dbName}`);
    if (svc && 'configured' in svc && svc.configured != null) {
      lines.push(`Configured: ${svc.configured ? 'yes' : 'no'}`);
    }
    if (svc && 'error' in svc && svc.error) lines.push(`Error: ${svc.error}`);
  }

  if (snapshot.kind === 'offline' && tile.id === 'localLan') {
    lines.push(`Cloud mode: ${snapshot.lanOnly ? 'LAN only' : 'Cloud connected'}`);
  }

  return lines;
}

export async function fetchMonitorFeed(
  mode: HealthMonitorMode,
  accessToken?: string | null
): Promise<MonitorFeedSnapshot> {
  const base = mode === 'offline' ? '' : getApiBaseUrl();
  const url = `${base}/api/monitor/snapshot`;
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  try {
    const res = await fetch(url, { cache: 'no-store', headers });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      const detail = body.message || body.error || res.statusText || `HTTP ${res.status}`;
      throw new Error(`Ops feed ${res.status}: ${detail}`);
    }
    return (await res.json()) as MonitorFeedSnapshot;
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error('Ops feed request failed');
  }
}

/** Ultritouch Log-tab ops login — issues ros_nsess without touching main-app auth storage. */
export async function loginForMonitorOps(
  email: string,
  password: string
): Promise<{ token: string; email: string; fullName: string }> {
  const base = getApiBaseUrl();
  const trimmedEmail = email.trim().toLowerCase();
  const res = await fetch(`${base}/api/auth/neon-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: trimmedEmail,
      password,
      full_name: trimmedEmail.split('@')[0] || 'User',
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    status?: string;
    email?: string;
    full_name?: string;
    error?: string;
    message?: string;
  };
  if (!res.ok || !data.token) {
    throw new Error(data.message || data.error || `Sign in failed (HTTP ${res.status})`);
  }
  if (data.status && data.status !== 'approved') {
    throw new Error(
      data.status === 'pending'
        ? 'Account is awaiting approval.'
        : data.status === 'rejected'
          ? 'Account access was rejected.'
          : `Account status: ${data.status}`
    );
  }
  return {
    token: data.token,
    email: data.email || trimmedEmail,
    fullName: data.full_name || trimmedEmail.split('@')[0] || 'User',
  };
}
