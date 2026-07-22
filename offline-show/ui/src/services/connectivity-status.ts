import type { CloudModePayload } from './socket-client';

export type ConnectivityPill = {
  ok: boolean;
  label: string;
  latencyMs?: number;
  error?: string | null;
  status?: string;
  dbName?: string | null;
  db?: string;
  skipped?: boolean;
  reason?: string;
};

export type RailwayApiTokenStatus = {
  configured: boolean;
  prefix: string | null;
  source: 'env' | 'db' | null;
  locked: boolean;
  canWrite?: boolean | null;
  writeError?: string | null;
};

export type ConnectivitySnapshot = {
  app: string;
  cloudMode: 'lan-only' | 'cloud-connected';
  lanOnly: boolean;
  cloudConnected: boolean;
  cloudModeUpdatedAt?: string | null;
  railwayApiToken?: RailwayApiTokenStatus;
  timestamp: string;
  cached?: boolean;
  internet: ConnectivityPill;
  railway: ConnectivityPill;
  neon: ConnectivityPill;
  localLan: ConnectivityPill;
};

export type CloudModeState = CloudModePayload & {
  sync?: {
    direction?: string;
    events?: number;
    runOfShowLocalWins?: number;
    runOfShowCloudWins?: number;
    calendarEvents?: number;
    runOfShow?: number;
    liveState?: number;
    errors?: string[];
    source?: string;
  };
};

export async function fetchConnectivityStatus(): Promise<ConnectivitySnapshot> {
  const res = await fetch('/api/connectivity-status', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Connectivity check failed (${res.status})`);
  }
  return res.json() as Promise<ConnectivitySnapshot>;
}

export async function fetchCloudMode(): Promise<CloudModeState> {
  const res = await fetch('/api/cloud-mode', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Cloud mode fetch failed (${res.status})`);
  return res.json() as Promise<CloudModeState>;
}

export async function setCloudMode(
  mode: 'lan-only' | 'cloud-connected',
  updatedBy?: string
): Promise<CloudModeState> {
  const res = await fetch('/api/cloud-mode', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, updatedBy }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<CloudModeState>;
}

export async function fetchRailwayApiTokenStatus(): Promise<RailwayApiTokenStatus> {
  const res = await fetch('/api/railway-api-token', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Token status fetch failed (${res.status})`);
  return res.json() as Promise<RailwayApiTokenStatus>;
}

export async function saveRailwayApiToken(token: string): Promise<RailwayApiTokenStatus> {
  const res = await fetch('/api/railway-api-token', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<RailwayApiTokenStatus>;
}

export async function clearRailwayApiToken(): Promise<RailwayApiTokenStatus> {
  const res = await fetch('/api/railway-api-token', { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<RailwayApiTokenStatus>;
}
