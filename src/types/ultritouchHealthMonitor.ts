/** Ross DashBoard Ultritouch 4 template canvas (User Guide §5-11). */
export const ULTRITOUCH_4_PANEL_WIDTH = 1304;
export const ULTRITOUCH_4_PANEL_HEIGHT = 485;

/**
 * Ross DashBoard Ultritouch 2 / 2U custom panel canvas.
 * Common PanelBuilder size: gridwidth=1304 gridheight=203 (community / Ultrix layout).
 */
export const ULTRITOUCH_2_PANEL_WIDTH = 1304;
export const ULTRITOUCH_2_PANEL_HEIGHT = 203;

export type UltritouchPanelSize = '2u' | '4u';

export function ultritouchPanelDims(panel: UltritouchPanelSize = '4u') {
  if (panel === '2u') {
    return { width: ULTRITOUCH_2_PANEL_WIDTH, height: ULTRITOUCH_2_PANEL_HEIGHT };
  }
  return { width: ULTRITOUCH_4_PANEL_WIDTH, height: ULTRITOUCH_4_PANEL_HEIGHT };
}

export type HealthMonitorMode = 'cloud' | 'offline';

export type OverallHealthState = 'healthy' | 'degraded' | 'down' | 'loading';

export interface CloudServiceStatus {
  connected?: boolean;
  configured?: boolean;
  label?: string;
  dbName?: string | null;
  nodeVersion?: string;
  uptimeSeconds?: number;
  env?: string;
  latencyMs?: number;
  error?: string | null;
}

export interface CloudHealthSnapshot {
  kind: 'cloud';
  status: string;
  timestamp?: string;
  error?: string;
  services?: {
    neon?: CloudServiceStatus;
    railway?: CloudServiceStatus;
    upstash?: CloudServiceStatus;
  };
  netlify?: StatuspageSnapshot;
  resend?: StatuspageSnapshot;
}

export interface ConnectivityPill {
  ok: boolean;
  label: string;
  latencyMs?: number;
  error?: string | null;
  status?: string;
  dbName?: string | null;
  db?: string;
  skipped?: boolean;
  reason?: string;
}

export interface OfflineHealthSnapshot {
  kind: 'offline';
  app: string;
  cloudMode: 'lan-only' | 'cloud-connected';
  lanOnly: boolean;
  cloudConnected: boolean;
  cloudModeUpdatedAt?: string | null;
  timestamp: string;
  cached?: boolean;
  internet: ConnectivityPill;
  railway: ConnectivityPill;
  neon: ConnectivityPill;
  localLan: ConnectivityPill;
  netlify?: StatuspageSnapshot;
  resend?: StatuspageSnapshot;
}

export type HealthMonitorSnapshot = CloudHealthSnapshot | OfflineHealthSnapshot;

/** Atlassian Statuspage public summary (e.g. Netlify, Resend). */
export interface StatuspageSnapshot {
  ok: boolean;
  indicator: 'none' | 'minor' | 'major' | 'critical' | 'unknown';
  description: string;
  updatedAt?: string;
  /** Highlighted component, e.g. CDN / Edge */
  highlightName?: string;
  highlightStatus?: string;
  error?: string;
}

/** @deprecated Prefer StatuspageSnapshot */
export type NetlifyStatusSnapshot = StatuspageSnapshot;

export interface HealthMonitorTile {
  id: string;
  label: string;
  subtitle: string;
  ok: boolean;
  /** Three-state status for Ross panel: OK / ALERT / FAIL */
  level: 'ok' | 'alert' | 'fail';
  skipped?: boolean;
  detail?: string;
  latencyMs?: number;
  accent: 'teal' | 'violet' | 'amber' | 'sky' | 'rose' | 'emerald';
}

export type HealthLogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface HealthLogEntry {
  id: string;
  at: string;
  level: HealthLogLevel;
  serviceId?: string;
  message: string;
  detail?: string;
}

export type HealthLogFilter = 'all' | 'alerts' | 'selected';

export type MonitorPanelTab = 'dashboard' | 'log';

export interface MonitorOpsEvent {
  eventId: string;
  eventName: string;
  viewerCount: number;
}

export interface MonitorRunningTimer {
  eventId: string;
  eventName: string;
  cueIs: string;
  startedAt: string | null;
}

export interface MonitorFeedSnapshot {
  timestamp: string;
  ops: {
    activeEventCount: number;
    totalViewers: number | null;
    socketConnections: number | null;
    events: MonitorOpsEvent[];
    runningTimers: MonitorRunningTimer[];
  };
}
