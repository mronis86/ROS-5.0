import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Database, Server, Zap, Users, Timer, Square, FolderOpen, Mail, Copy, Check, Image, Key, X, Calendar, Cloud, Wrench } from 'lucide-react';
import { getApiBaseUrl } from '../services/api-client';
import { fetchNetlifyStatus, fetchResendStatus } from '../lib/ultritouchHealthMonitor';
import { GOOGLE_APPS_SCRIPT_BACKUP_SOURCE } from '../lib/google-apps-script-backup';
import {
  getLogoVariant,
  getLogoVariantId,
  LOGO_VARIANTS,
  applyLogoVariantId,
  type LogoVariantId,
} from '../lib/branding';
import {
  fetchAdminAppSettings,
  saveAdminLogoVariant,
  syncAdminAppSettingsTable,
} from '../lib/appSettings';
import AppLogo from '../components/AppLogo';
import AppBrandTitle from '../components/AppBrandTitle';
import {
  approvedDomainInputHint,
  normalizeApprovedDomainInput,
} from '../lib/approvedDomains';
import {
  buildApprovalEmailDraft,
  buildApprovalMailtoUrl,
} from '../lib/accessPortalMessages';

import {
  adminFetch,
  adminFetchWithCredentials,
  canUseNeonAdminSession,
  clearStoredAdminCredentials,
  describeAdminAuthFailure,
  fetchAdminAuthStatus,
  isAdminSessionUnlocked,
  setStoredAdminCredentials,
  ADMIN_UNLOCK_KEY,
} from '../lib/adminAuth';
import { useAuth } from '../contexts/AuthContext';
import { isNeonAuthEnabled } from '../lib/neonAuthClient';

type AccessStatus = 'pending' | 'approved' | 'rejected';
type AccessSortKey = 'full_name' | 'email' | 'status' | 'requested_at' | 'reviewed_at';

interface AccessRequestRow {
  id: string;
  email: string;
  full_name: string;
  status: AccessStatus;
  requested_at: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  notes?: string | null;
  is_admin?: boolean;
  is_event_manager?: boolean;
  neon_user_id?: string | null;
  password_set_at?: string | null;
  portal_url?: string | null;
  event_access_count?: number;
  dashboard_enabled?: boolean;
}

interface EventAccessCalendarRow {
  id: string;
  name: string;
  date: string;
}

const PUZZLE_ALL_COLORS = [
  { name: 'red', bg: 'bg-red-500', border: 'border-red-400' },
  { name: 'green', bg: 'bg-green-500', border: 'border-green-400' },
  { name: 'blue', bg: 'bg-blue-500', border: 'border-blue-400' },
  { name: 'orange', bg: 'bg-orange-500', border: 'border-orange-400' },
  { name: 'purple', bg: 'bg-purple-500', border: 'border-purple-400' },
  { name: 'yellow', bg: 'bg-yellow-500', border: 'border-yellow-400' },
  { name: 'pink', bg: 'bg-pink-500', border: 'border-pink-400' },
  { name: 'teal', bg: 'bg-teal-500', border: 'border-teal-400' },
  { name: 'brown', bg: 'bg-amber-700', border: 'border-amber-500' },
  { name: 'gray', bg: 'bg-gray-500', border: 'border-gray-400' },
  { name: 'navy', bg: 'bg-blue-900', border: 'border-blue-600' },
  { name: 'coral', bg: 'bg-red-400', border: 'border-red-300' },
].slice(0, 12);

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface ServiceStatus {
  connected?: boolean;
  configured?: boolean;
  label: string;
  dbName?: string | null;
  nodeVersion?: string;
  uptimeSeconds?: number;
  env?: string;
  latencyMs?: number;
  error?: string | null;
  description?: string;
  indicator?: 'none' | 'minor' | 'major' | 'critical' | 'unknown';
}

interface HealthData {
  status: string;
  timestamp?: string;
  dbConnected?: boolean;
  database?: string;
  upstashConfigured?: boolean;
  error?: string;
  services?: {
    neon?: ServiceStatus;
    railway?: ServiceStatus;
    upstash?: ServiceStatus;
    netlify?: ServiceStatus;
    resend?: ServiceStatus;
  };
}

const SERVICE_CONFIG = [
  { key: 'neon' as const, icon: Database, label: 'Neon', desc: 'Database', iconColor: 'teal' as const },
  { key: 'railway' as const, icon: Server, label: 'Railway', desc: 'API', iconColor: 'violet' as const },
  { key: 'upstash' as const, icon: Zap, label: 'Upstash', desc: 'Redis / KV', iconColor: 'amber' as const },
  { key: 'netlify' as const, icon: Cloud, label: 'Netlify', desc: 'CDN / hosting', iconColor: 'sky' as const },
  { key: 'resend' as const, icon: Mail, label: 'Resend', desc: 'Email', iconColor: 'rose' as const },
];

type ServiceLevel = 'ok' | 'warning' | 'disconnected';

function iconColorClasses(level: ServiceLevel, color: 'teal' | 'violet' | 'amber' | 'sky' | 'rose'): string {
  if (level === 'disconnected') return 'bg-slate-700/80 text-slate-400';
  if (level === 'warning') return 'bg-amber-500/20 text-amber-400';
  if (color === 'teal') return 'bg-teal-500/20 text-teal-400';
  if (color === 'violet') return 'bg-violet-500/20 text-violet-400';
  if (color === 'amber') return 'bg-amber-500/20 text-amber-400';
  if (color === 'sky') return 'bg-sky-500/20 text-sky-400';
  return 'bg-rose-500/20 text-rose-400';
}

function serviceLevel(key: (typeof SERVICE_CONFIG)[number]['key'], svc?: ServiceStatus): ServiceLevel {
  if (!svc) return 'disconnected';
  if (key === 'netlify' || key === 'resend') {
    if (svc.indicator === 'none' || (svc.connected && !svc.indicator)) return 'ok';
    if (svc.indicator === 'minor') return 'warning';
    return 'disconnected';
  }
  if (key === 'upstash') {
    if (svc.configured === false) return 'warning';
    const connected = typeof svc.connected === 'boolean' ? !!svc.connected : !!svc.configured;
    if (!connected) return 'disconnected';
    if (svc.latencyMs != null && svc.latencyMs >= 400) return 'warning';
    return 'ok';
  }
  return svc.connected ? 'ok' : 'disconnected';
}

function serviceStatusLabel(level: ServiceLevel, svc?: ServiceStatus): string {
  if (level === 'ok') {
    if (svc?.latencyMs != null) return `System Operational · ${svc.latencyMs} ms`;
    return 'System Operational';
  }
  if (level === 'warning') return 'Warning';
  return 'Disconnected';
}

function statusPillClasses(level: ServiceLevel): string {
  if (level === 'ok') return 'bg-emerald-500/20 text-emerald-400';
  if (level === 'warning') return 'bg-amber-500/20 text-amber-400';
  return 'bg-slate-700/80 text-slate-400';
}

function statusDotClasses(level: ServiceLevel): string {
  if (level === 'ok') return 'bg-emerald-400 animate-pulse';
  if (level === 'warning') return 'bg-amber-400 animate-pulse';
  return 'bg-slate-500';
}

const ADMIN_NAV: { id: string; label: string }[] = [
  { id: 'services', label: 'Services' },
  { id: 'platform', label: 'Platform' },
  { id: 'timers', label: 'Timers' },
  { id: 'presence', label: 'Events' },
  { id: 'access', label: 'Access' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'domains', label: 'Domains' },
  { id: 'backup', label: 'Backup' },
  { id: 'branding', label: 'Branding' },
];

type PlatformCheckLevel = 'ok' | 'warning' | 'critical' | 'unknown';

interface PlatformMaintenanceCheck {
  id: string;
  title: string;
  level: PlatformCheckLevel;
  label: string;
  whatIsThis?: string;
  plain?: string;
  detail?: string;
  action?: string | null;
  recommendBy?: string | null;
  recommendByLabel?: string | null;
  dateRight?: string | null;
  value?: string | null;
  technical?: string;
  meta?: {
    major?: number;
    eol?: string | null;
    eolDisplay?: string | null;
    daysRemaining?: number | null;
    latestInCycle?: string | null;
    lts?: boolean;
    eolDataSource?: string;
  };
}

interface PlatformMaintenanceRecommendation {
  id: string;
  title: string;
  level: PlatformCheckLevel;
  action: string;
  recommendBy?: string | null;
  recommendByLabel?: string | null;
  recommendByDisplay?: string | null;
}

interface PlatformMaintenanceReport {
  checkedAt: string;
  summary: {
    level: PlatformCheckLevel;
    headline?: string;
    audienceLabel?: string;
    critical: number;
    warning: number;
    ok: number;
  };
  runtime?: {
    nodeVersion?: string;
    env?: string;
    uptimeSeconds?: number;
  };
  pins?: {
    enginesNode?: string | null;
    nvmrc?: string | null;
    netlifyNode?: string | null;
  };
  eolSource?: string;
  eolError?: string | null;
  eolNote?: string;
  checks: PlatformMaintenanceCheck[];
  attention?: PlatformMaintenanceCheck[];
  recommendations?: PlatformMaintenanceRecommendation[];
  links?: {
    nodeEol?: string;
    nodeReleases?: string;
  };
}

function platformLevelPill(level: PlatformCheckLevel): string {
  if (level === 'ok') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (level === 'warning') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  if (level === 'critical') return 'bg-red-500/15 text-red-300 border-red-500/30';
  return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
}

function platformLevelDot(level: PlatformCheckLevel): string {
  if (level === 'ok') return 'bg-emerald-400';
  if (level === 'warning') return 'bg-amber-400';
  if (level === 'critical') return 'bg-red-400';
  return 'bg-slate-400';
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

interface PresenceViewer {
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
}

interface PresenceEvent {
  eventId: string;
  eventName: string;
  viewers: PresenceViewer[];
}

interface RunningTimerRow {
  eventId: string;
  eventName: string;
  itemId: number;
  cueIs: string;
  durationSeconds: number;
  startedAt: string;
  timerState: string;
}

export default function AdminPage() {
  const { user, loading: authLoading, accessStatus } = useAuth();
  const [unlocked, setUnlocked] = useState(false);
  const [activeNavId, setActiveNavId] = useState<string>('services');
  const [password, setPassword] = useState('');
  const [pendingAdminKey, setPendingAdminKey] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPuzzle, setShowPuzzle] = useState(false);
  const [puzzleCount, setPuzzleCount] = useState(3);
  const [puzzleSelected, setPuzzleSelected] = useState<string[]>([]);
  const [puzzleShuffled, setPuzzleShuffled] = useState<typeof PUZZLE_ALL_COLORS>([]);
  const [puzzleVerifying, setPuzzleVerifying] = useState(false);
  const [puzzleError, setPuzzleError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [presence, setPresence] = useState<PresenceEvent[]>([]);
  const [presenceLoading, setPresenceLoading] = useState(false);
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const [runningTimers, setRunningTimers] = useState<RunningTimerRow[]>([]);
  const [runningTimersLoading, setRunningTimersLoading] = useState(false);
  const [runningTimersError, setRunningTimersError] = useState<string | null>(null);
  const [stoppingEventId, setStoppingEventId] = useState<string | null>(null);
  const [disconnectingUserId, setDisconnectingUserId] = useState<string | null>(null);
  const [backupConfig, setBackupConfig] = useState<{ enabled: boolean; folderId: string; lastRunAt: string | null; lastStatus: string | null; needsMigration?: boolean; hasServiceAccount?: boolean }>({ enabled: false, folderId: '', lastRunAt: null, lastStatus: null });
  const [backupConfigLoading, setBackupConfigLoading] = useState(false);
  const [backupConfigSaving, setBackupConfigSaving] = useState(false);
  const [backupConfigError, setBackupConfigError] = useState<string | null>(null);
  const [backupFolderIdInput, setBackupFolderIdInput] = useState('');
  const [backupServiceAccountInput, setBackupServiceAccountInput] = useState('');
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupTableCheck, setBackupTableCheck] = useState<{ exists?: boolean; error?: string } | null>(null);
  const [backupCreatingTable, setBackupCreatingTable] = useState(false);
  const [backupSyncingTable, setBackupSyncingTable] = useState(false);
  const [approvedDomains, setApprovedDomains] = useState<string[]>([]);
  const [approvedDomainsLoading, setApprovedDomainsLoading] = useState(false);
  const [approvedDomainsError, setApprovedDomainsError] = useState<string | null>(null);
  const [addDomainInput, setAddDomainInput] = useState('');
  const [addDomainLoading, setAddDomainLoading] = useState(false);
  const [domainsNeedsMigration, setDomainsNeedsMigration] = useState(false);
  const [domainsSyncingTable, setDomainsSyncingTable] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [integrationTokens, setIntegrationTokens] = useState<
    Array<{
      id: string;
      name: string;
      token_prefix: string;
      scopes: string[];
      event_id: string | null;
      expires_at: string | null;
      revoked_at: string | null;
      created_at: string;
    }>
  >([]);
  const [integrationTokensLoading, setIntegrationTokensLoading] = useState(false);
  const [integrationTokensError, setIntegrationTokensError] = useState<string | null>(null);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenEventId, setNewTokenEventId] = useState('');
  const [newTokenScopes, setNewTokenScopes] = useState('read,control');
  const [creatingToken, setCreatingToken] = useState(false);
  const [createdTokenValue, setCreatedTokenValue] = useState<string | null>(null);
  const [createdTokenCopied, setCreatedTokenCopied] = useState(false);
  const createdTokenBannerRef = useRef<HTMLDivElement | null>(null);
  const [accessRequests, setAccessRequests] = useState<AccessRequestRow[]>([]);
  const [accessRequestsLoading, setAccessRequestsLoading] = useState(false);
  const [accessRequestsError, setAccessRequestsError] = useState<string | null>(null);
  const [accessStatusFilter, setAccessStatusFilter] = useState<'all' | AccessStatus>('all');
  const [accessSort, setAccessSort] = useState<{ key: AccessSortKey; dir: 'asc' | 'desc' }>({
    key: 'full_name',
    dir: 'asc',
  });
  const [accessUserSearch, setAccessUserSearch] = useState('');
  const [dashboardNeedsMigration, setDashboardNeedsMigration] = useState(false);
  const [copiedPortalUserId, setCopiedPortalUserId] = useState<string | null>(null);
  const [eventAccessUser, setEventAccessUser] = useState<AccessRequestRow | null>(null);
  const [eventAccessLoading, setEventAccessLoading] = useState(false);
  const [eventAccessSaving, setEventAccessSaving] = useState(false);
  const [eventAccessError, setEventAccessError] = useState<string | null>(null);
  const [eventAccessEvents, setEventAccessEvents] = useState<EventAccessCalendarRow[]>([]);
  const [eventAccessSelected, setEventAccessSelected] = useState<Set<string>>(new Set());
  const [eventAccessSearch, setEventAccessSearch] = useState('');
  const [accessEmailDraft, setAccessEmailDraft] = useState<{
    email: string;
    fullName: string;
    portalUrl: string;
    isAdmin: boolean;
  } | null>(null);
  const [accessEmailCopied, setAccessEmailCopied] = useState(false);
  const [logoVariantId, setLogoVariantIdState] = useState<LogoVariantId>(() => getLogoVariantId());
  const [logoSettingsLoading, setLogoSettingsLoading] = useState(false);
  const [logoSettingsSaving, setLogoSettingsSaving] = useState(false);
  const [logoSettingsError, setLogoSettingsError] = useState<string | null>(null);
  const [logoSettingsNeedsMigration, setLogoSettingsNeedsMigration] = useState(false);
  const [logoSettingsSyncingTable, setLogoSettingsSyncingTable] = useState(false);
  const [logoSettingsUpdatedAt, setLogoSettingsUpdatedAt] = useState<string | null>(null);
  const [platformReport, setPlatformReport] = useState<PlatformMaintenanceReport | null>(null);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformError, setPlatformError] = useState<string | null>(null);

  const fetchPlatformMaintenance = useCallback(async () => {
    setPlatformLoading(true);
    setPlatformError(null);
    try {
      const res = await adminFetch('/api/admin/platform-maintenance');
      if (res.status === 401) {
        setPlatformError('Unauthorized');
        setPlatformReport(null);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as PlatformMaintenanceReport & { error?: string };
      if (!res.ok) {
        setPlatformError(data.error || `HTTP ${res.status}`);
        setPlatformReport(null);
        return;
      }
      setPlatformReport(data);
    } catch (e) {
      setPlatformError(e instanceof Error ? e.message : 'Request failed');
      setPlatformReport(null);
    } finally {
      setPlatformLoading(false);
    }
  }, []);

  const fetchLogoSettings = useCallback(async () => {
    setLogoSettingsLoading(true);
    setLogoSettingsError(null);
    try {
      const settings = await fetchAdminAppSettings();
      setLogoSettingsNeedsMigration(settings.needsMigration === true);
      setLogoSettingsUpdatedAt(settings.updatedAt);
      applyLogoVariantId(settings.logoVariantId);
      setLogoVariantIdState(settings.logoVariantId);
    } catch (err) {
      setLogoSettingsError(err instanceof Error ? err.message : 'Failed to load logo settings');
    } finally {
      setLogoSettingsLoading(false);
    }
  }, []);

  const handleLogoVariantChange = async (id: LogoVariantId) => {
    if (logoSettingsSaving || logoSettingsNeedsMigration) return;
    setLogoSettingsSaving(true);
    setLogoSettingsError(null);
    try {
      const settings = await saveAdminLogoVariant(id);
      setLogoVariantIdState(settings.logoVariantId);
      setLogoSettingsUpdatedAt(settings.updatedAt);
      setLogoSettingsNeedsMigration(false);
    } catch (err) {
      setLogoSettingsError(err instanceof Error ? err.message : 'Failed to save logo setting');
    } finally {
      setLogoSettingsSaving(false);
    }
  };

  const handleSyncLogoSettingsTable = async () => {
    setLogoSettingsSyncingTable(true);
    setLogoSettingsError(null);
    try {
      const settings = await syncAdminAppSettingsTable();
      setLogoSettingsNeedsMigration(false);
      setLogoSettingsUpdatedAt(settings.updatedAt);
      applyLogoVariantId(settings.logoVariantId);
      setLogoVariantIdState(settings.logoVariantId);
    } catch (err) {
      setLogoSettingsError(err instanceof Error ? err.message : 'Failed to create app_settings table');
    } finally {
      setLogoSettingsSyncingTable(false);
    }
  };

  useEffect(() => {
    if (isAdminSessionUnlocked()) {
      setUnlocked(true);
    }
  }, []);

  const neonAdminMaySignIn =
    !isNeonAuthEnabled || canUseNeonAdminSession() || user?.is_admin === true;

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const base = getApiBaseUrl();
      const [res, netlify, resend] = await Promise.all([
        fetch(`${base}/health`),
        fetchNetlifyStatus(),
        fetchResendStatus(),
      ]);
      const data = await res.json().catch(() => ({}));
      const statuspageServices = {
        netlify: {
          connected: netlify.ok,
          label: 'Netlify',
          description: netlify.description,
          indicator: netlify.indicator,
          error: netlify.error || null,
        },
        resend: {
          connected: resend.ok,
          label: 'Resend',
          description: resend.description,
          indicator: resend.indicator,
          error: resend.error || null,
        },
      };
      if (!res.ok) {
        setHealth({
          status: 'unhealthy',
          error: data.error || `HTTP ${res.status}`,
          timestamp: (data as any).timestamp,
          services: {
            ...(data.services ?? {
              neon: { connected: false, label: 'Neon' },
              railway: { connected: true, label: 'Railway' },
              upstash: { configured: !!(data as any).upstashConfigured, label: 'Upstash' },
            }),
            ...statuspageServices,
          },
        });
        return;
      }
      if (!data.services) {
        data.services = {
          neon: { connected: !!data.dbConnected, label: 'Neon', dbName: null },
          railway: { connected: data.status === 'healthy', label: 'Railway', nodeVersion: undefined, uptimeSeconds: undefined, env: undefined },
          upstash: { configured: !!data.upstashConfigured, label: 'Upstash' },
        };
      }
      setHealth({
        ...data,
        services: {
          ...data.services,
          ...statuspageServices,
        },
      });
    } catch (e) {
      setHealth({
        status: 'unhealthy',
        error: e instanceof Error ? e.message : 'Request failed',
        services: {
          neon: { connected: false, label: 'Neon' },
          railway: { connected: false, label: 'Railway' },
          upstash: { configured: false, label: 'Upstash' },
          netlify: { connected: false, label: 'Netlify' },
          resend: { connected: false, label: 'Resend' },
        },
      });
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const fetchPresence = useCallback(async () => {
    setPresenceLoading(true);
    setPresenceError(null);
    try {
      const res = await adminFetch('/api/admin/presence');
      if (res.status === 401) {
        setPresenceError('Unauthorized');
        setPresence([]);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = res.status === 404
          ? 'Presence endpoint not found (404). Redeploy the API (e.g. Railway) with the latest api-server.js.'
          : (err.error || `HTTP ${res.status}`);
        setPresenceError(msg);
        setPresence([]);
        return;
      }
      const data = await res.json().catch(() => ({}));
      const raw = Array.isArray(data.events) ? data.events : [];
      setPresence(raw.map((ev: { eventId?: string; eventName?: string; viewers?: PresenceViewer[] }) => ({
        eventId: String(ev.eventId ?? ''),
        eventName: String(ev.eventName ?? ''),
        viewers: Array.isArray(ev.viewers) ? ev.viewers : [],
      })));
    } catch (e) {
      setPresenceError(e instanceof Error ? e.message : 'Request failed');
      setPresence([]);
    } finally {
      setPresenceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    fetchHealth();
    const interval = setInterval(fetchHealth, 30_000);
    return () => clearInterval(interval);
  }, [unlocked, fetchHealth]);

  useEffect(() => {
    if (!unlocked) return;
    const sectionIds = ADMIN_NAV.map((item) => item.id);
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) {
          setActiveNavId(visible[0].target.id);
        }
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0.1, 0.25, 0.5] }
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return;
    fetchPresence();
    const interval = setInterval(fetchPresence, 15_000);
    return () => clearInterval(interval);
  }, [unlocked, fetchPresence]);

  const fetchBackupConfig = useCallback(async () => {
    setBackupConfigLoading(true);
    setBackupConfigError(null);
    try {
      const res = await adminFetch('/api/admin/backup-config');
      if (res.status === 401) {
        setBackupConfigError('Unauthorized');
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setBackupConfigError((err as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { enabled?: boolean; folderId?: string; lastRunAt?: string | null; lastStatus?: string | null; needsMigration?: boolean; hasServiceAccount?: boolean };
      setBackupConfig({
        enabled: !!data.enabled,
        folderId: data.folderId ?? '',
        lastRunAt: data.lastRunAt ?? null,
        lastStatus: data.lastStatus ?? null,
        needsMigration: !!data.needsMigration,
        hasServiceAccount: !!data.hasServiceAccount,
      });
      setBackupFolderIdInput(data.folderId ?? '');
    } catch (e) {
      setBackupConfigError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBackupConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    fetchBackupConfig();
  }, [unlocked, fetchBackupConfig]);

  useEffect(() => {
    if (!unlocked) return;
    void fetchLogoSettings();
  }, [unlocked, fetchLogoSettings]);

  const saveBackupConfig = useCallback(async () => {
    setBackupConfigSaving(true);
    setBackupConfigError(null);
    try {
      const body: { enabled: boolean; folderId: string | null; serviceAccountJson?: string | null } = {
        enabled: backupConfig.enabled,
        folderId: backupFolderIdInput.trim() || null,
      };
      if (backupServiceAccountInput.trim() !== '') {
        body.serviceAccountJson = backupServiceAccountInput.trim();
      }
      const res = await adminFetch('/api/admin/backup-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        setBackupConfigError('Unauthorized');
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setBackupConfigError((err as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { enabled?: boolean; folderId?: string };
      setBackupConfig((prev) => ({ ...prev, enabled: !!data.enabled, folderId: data.folderId ?? '' }));
      setBackupFolderIdInput(data.folderId ?? '');
      if (backupServiceAccountInput.trim() !== '') {
        setBackupConfig((prev) => ({ ...prev, hasServiceAccount: true }));
        setBackupServiceAccountInput('');
      }
      await fetchBackupConfig();
    } catch (e) {
      setBackupConfigError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBackupConfigSaving(false);
    }
  }, [backupConfig.enabled, backupFolderIdInput, backupServiceAccountInput, fetchBackupConfig]);

  const clearBackupCredentials = useCallback(async () => {
    if (!confirm('Clear stored service account JSON? Backup will use GOOGLE_SERVICE_ACCOUNT_JSON from API env if set.')) return;
    setBackupConfigSaving(true);
    setBackupConfigError(null);
    try {
      const res = await adminFetch('/api/admin/backup-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceAccountJson: null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setBackupConfigError((err as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }
      setBackupServiceAccountInput('');
      await fetchBackupConfig();
    } catch (e) {
      setBackupConfigError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBackupConfigSaving(false);
    }
  }, [fetchBackupConfig]);

  const checkBackupTable = useCallback(async () => {
    setBackupTableCheck(null);
    try {
      const res = await adminFetch('/api/admin/backup-config/check-table');
      const data = (await res.json()) as { exists?: boolean; error?: string };
      setBackupTableCheck({ exists: data.exists, error: data.error });
      if (data.exists) await fetchBackupConfig();
    } catch (e) {
      setBackupTableCheck({ exists: false, error: e instanceof Error ? e.message : 'Request failed' });
    }
  }, [fetchBackupConfig]);

  const createBackupTable = useCallback(async () => {
    setBackupCreatingTable(true);
    setBackupConfigError(null);
    try {
      const res = await adminFetch('/api/admin/backup-config/create-table', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setBackupConfigError((data as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }
      if ((data as { ok?: boolean }).ok) {
        await checkBackupTable();
        await fetchBackupConfig();
      }
    } catch (e) {
      setBackupConfigError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBackupCreatingTable(false);
    }
  }, [checkBackupTable, fetchBackupConfig]);

  const syncBackupTable = useCallback(async () => {
    setBackupSyncingTable(true);
    setBackupConfigError(null);
    try {
      const res = await adminFetch('/api/admin/backup-config/sync-table', { method: 'POST' });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok) {
        setBackupConfigError((data as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }
      if ((data as { ok?: boolean }).ok) {
        await checkBackupTable();
        await fetchBackupConfig();
      }
    } catch (e) {
      setBackupConfigError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBackupSyncingTable(false);
    }
  }, [checkBackupTable, fetchBackupConfig]);

  const runBackupNow = useCallback(async () => {
    setBackupRunning(true);
    setBackupConfigError(null);
    try {
      const res = await adminFetch('/api/admin/backup-config/run-now', { method: 'POST' });
      const rawText = await res.text();
      const data = (() => {
        try {
          return JSON.parse(rawText) as { ok?: boolean; error?: string; errorDetail?: string };
        } catch {
          return {};
        }
      })();
      const errMsg = (data as { error?: string }).error || (res.ok ? '' : `HTTP ${res.status}`);
      const errDetail = (data as { errorDetail?: string }).errorDetail;

      if (res.status === 401) {
        setBackupConfigError('Unauthorized');
        console.error('[Backup] Unauthorized');
        window.alert('Backup: Unauthorized');
        return;
      }
      if (!res.ok || !(data as { ok?: boolean }).ok) {
        const displayMsg = errMsg || 'Backup failed';
        setBackupConfigError(displayMsg);
        console.error('[Backup] Failed:', { status: res.status, error: errMsg, errorDetail: errDetail, raw: rawText });
        window.alert(`Backup failed:\n\n${displayMsg}\n\n(Full details in browser console: F12 → Console)`);
        return;
      }
      await fetchBackupConfig();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed';
      setBackupConfigError(msg);
      console.error('[Backup] Error:', e);
      window.alert(`Backup error:\n\n${msg}`);
    } finally {
      setBackupRunning(false);
    }
  }, [fetchBackupConfig]);

  const fetchApprovedDomains = useCallback(async () => {
    setApprovedDomainsLoading(true);
    setApprovedDomainsError(null);
    try {
      const res = await adminFetch('/api/admin/approved-domains');
      if (res.status === 401) {
        setApprovedDomainsError('Unauthorized');
        setApprovedDomains([]);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setApprovedDomainsError((err as { error?: string }).error || `HTTP ${res.status}`);
        setApprovedDomains([]);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { domains?: string[]; needsMigration?: boolean };
      setDomainsNeedsMigration(!!data.needsMigration);
      setApprovedDomains(Array.isArray(data.domains) ? data.domains : []);
    } catch (e) {
      setApprovedDomainsError(e instanceof Error ? e.message : 'Request failed');
      setApprovedDomains([]);
    } finally {
      setApprovedDomainsLoading(false);
    }
  }, []);

  const addApprovedDomain = useCallback(async () => {
    const domain = normalizeApprovedDomainInput(addDomainInput);
    if (!domain) {
      setApprovedDomainsError(approvedDomainInputHint());
      return;
    }
    setAddDomainLoading(true);
    setApprovedDomainsError(null);
    try {
      const res = await adminFetch('/api/admin/approved-domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      if (res.status === 401) {
        setApprovedDomainsError('Unauthorized — lock and re-enter the admin key, or sign in as an admin user.');
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; domains?: string[]; error?: string };
      if (!res.ok) {
        setApprovedDomainsError(data.error || `HTTP ${res.status}`);
        return;
      }
      if (data.ok && Array.isArray(data.domains)) {
        setApprovedDomains(data.domains);
        setAddDomainInput('');
        setDomainsNeedsMigration(false);
      } else {
        setApprovedDomainsError('Domain was not saved. Try again or use Sync table below.');
      }
    } catch (e) {
      setApprovedDomainsError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setAddDomainLoading(false);
    }
  }, [addDomainInput]);

  const syncApprovedDomainsTable = useCallback(async () => {
    setDomainsSyncingTable(true);
    setApprovedDomainsError(null);
    try {
      const res = await adminFetch('/api/admin/approved-domains/sync-table', { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setApprovedDomainsError(data.error || `HTTP ${res.status}`);
        return;
      }
      setDomainsNeedsMigration(false);
      await fetchApprovedDomains();
    } catch (e) {
      setApprovedDomainsError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setDomainsSyncingTable(false);
    }
  }, [fetchApprovedDomains]);

  const fetchAccessRequests = useCallback(async () => {
    setAccessRequestsLoading(true);
    setAccessRequestsError(null);
    try {
      const res = await adminFetch(`/api/admin/access-requests?status=${accessStatusFilter}`);
      if (res.status === 401) {
        setAccessRequestsError('Unauthorized');
        setAccessRequests([]);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAccessRequestsError((err as { error?: string }).error || `HTTP ${res.status}`);
        setAccessRequests([]);
        return;
      }
      const data = (await res.json()) as {
        requests?: AccessRequestRow[];
        needsMigration?: boolean;
        dashboardNeedsMigration?: boolean;
      };
      if (data.needsMigration) {
        setAccessRequestsError('Run migration 027 on Neon for access approval.');
        setAccessRequests([]);
        setDashboardNeedsMigration(false);
        return;
      }
      setDashboardNeedsMigration(data.dashboardNeedsMigration === true);
      setAccessRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch (e) {
      setAccessRequestsError(e instanceof Error ? e.message : 'Request failed');
      setAccessRequests([]);
    } finally {
      setAccessRequestsLoading(false);
    }
  }, [accessStatusFilter]);

  const approveAccessRequest = useCallback(
    async (id: string, email: string, fullName: string, makeAdmin = false) => {
      if (!confirm(`Approve access for ${email}?${makeAdmin ? ' (as administrator)' : ''}`)) return;
      setAccessRequestsError(null);
      try {
        const res = await adminFetch(`/api/admin/access-requests/${id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ make_admin: makeAdmin }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          portalUrl?: string;
          request?: { full_name?: string; is_admin?: boolean };
        };
        if (!res.ok) {
          setAccessRequestsError(data.error || `HTTP ${res.status}`);
          return;
        }
        await fetchAccessRequests();
        if (data.portalUrl) {
          setAccessEmailDraft({
            email,
            fullName: data.request?.full_name || fullName,
            portalUrl: data.portalUrl,
            isAdmin: makeAdmin || !!data.request?.is_admin,
          });
        }
      } catch (e) {
        setAccessRequestsError(e instanceof Error ? e.message : 'Request failed');
      }
    },
    [fetchAccessRequests]
  );

  const rejectAccessRequest = useCallback(
    async (id: string, email: string) => {
      if (!confirm(`Reject access for ${email}?`)) return;
      setAccessRequestsError(null);
      try {
        const res = await adminFetch(`/api/admin/access-requests/${id}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setAccessRequestsError((data as { error?: string }).error || `HTTP ${res.status}`);
          return;
        }
        await fetchAccessRequests();
      } catch (e) {
        setAccessRequestsError(e instanceof Error ? e.message : 'Request failed');
      }
    },
    [fetchAccessRequests]
  );

  const updateAccessUser = useCallback(
    async (
      id: string,
      email: string,
      patch: { status?: AccessStatus; is_admin?: boolean; is_event_manager?: boolean; dashboard_enabled?: boolean; notes?: string; reset_account?: boolean; notify_user?: boolean }
    ) => {
      setAccessRequestsError(null);
      try {
        const res = await adminFetch(`/api/admin/access-requests/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setAccessRequestsError((data as { error?: string }).error || `HTTP ${res.status}`);
          return;
        }
        await fetchAccessRequests();
      } catch (e) {
        setAccessRequestsError(e instanceof Error ? e.message : 'Request failed');
      }
    },
    [fetchAccessRequests]
  );

  const deleteAccessUser = useCallback(
    async (id: string, email: string) => {
      if (
        !confirm(
          `Permanently remove ${email} from Run of Show?\n\nThis deletes their access record, API sessions, and Neon Auth login (if one exists).`
        )
      ) {
        return;
      }
      setAccessRequestsError(null);
      try {
        const res = await adminFetch(`/api/admin/access-requests/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setAccessRequestsError((data as { error?: string }).error || `HTTP ${res.status}`);
          return;
        }
        const data = (await res.json().catch(() => ({}))) as {
          neon_auth_removed?: boolean;
          neon_auth_error?: string | null;
          hint?: string;
        };
        if (data.neon_auth_removed === false && data.neon_auth_error) {
          setAccessRequestsError(
            `User removed from Run of Show, but Neon Auth login may still exist: ${data.neon_auth_error}`
          );
        }
        await fetchAccessRequests();
      } catch (e) {
        setAccessRequestsError(e instanceof Error ? e.message : 'Request failed');
      }
    },
    [fetchAccessRequests]
  );

  const closeEventAccessModal = useCallback(() => {
    setEventAccessUser(null);
    setEventAccessError(null);
    setEventAccessEvents([]);
    setEventAccessSelected(new Set());
    setEventAccessSearch('');
  }, []);

  const openEventAccessModal = useCallback(async (row: AccessRequestRow) => {
    setEventAccessUser(row);
    setEventAccessLoading(true);
    setEventAccessError(null);
    setEventAccessSearch('');
    try {
      const res = await adminFetch(`/api/admin/access-requests/${row.id}/event-access`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEventAccessError((data as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as {
        event_ids?: string[];
        events?: EventAccessCalendarRow[];
        needsMigration?: boolean;
      };
      if (data.needsMigration) {
        setEventAccessError('Run migration 031 on Neon to enable per-user event access.');
      }
      const ids = Array.isArray(data.event_ids) ? data.event_ids : [];
      setEventAccessEvents(Array.isArray(data.events) ? data.events : []);
      setEventAccessSelected(new Set(ids));
    } catch (e) {
      setEventAccessError(e instanceof Error ? e.message : 'Failed to load event access');
    } finally {
      setEventAccessLoading(false);
    }
  }, []);

  const toggleEventAccessSelection = useCallback((eventId: string) => {
    setEventAccessSelected((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }, []);

  const saveEventAccess = useCallback(async () => {
    if (!eventAccessUser) return;
    setEventAccessSaving(true);
    setEventAccessError(null);
    try {
      const event_ids = [...eventAccessSelected];
      const res = await adminFetch(`/api/admin/access-requests/${eventAccessUser.id}/event-access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_ids }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setEventAccessError((data as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }
      closeEventAccessModal();
      await fetchAccessRequests();
    } catch (e) {
      setEventAccessError(e instanceof Error ? e.message : 'Failed to save event access');
    } finally {
      setEventAccessSaving(false);
    }
  }, [closeEventAccessModal, eventAccessSelected, eventAccessUser, fetchAccessRequests]);

  const filteredEventAccessEvents = useMemo(() => {
    const q = eventAccessSearch.trim().toLowerCase();
    if (!q) return eventAccessEvents;
    return eventAccessEvents.filter(
      (event) =>
        event.name.toLowerCase().includes(q) ||
        event.id.toLowerCase().includes(q) ||
        event.date.includes(q)
    );
  }, [eventAccessEvents, eventAccessSearch]);

  const toggleAccessSort = (key: AccessSortKey) => {
    setAccessSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  };

  const sortedAccessRequests = useMemo(() => {
    const rows = [...accessRequests];
    const { key, dir } = accessSort;
    const factor = dir === 'asc' ? 1 : -1;
    const sortValue = (row: AccessRequestRow, sortKey: AccessSortKey) => {
      if (sortKey === 'full_name') {
        return (row.full_name || row.email || '').trim();
      }
      if (sortKey === 'reviewed_at') {
        return row.reviewed_at || '';
      }
      return String(row[sortKey] || '');
    };
    rows.sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      if (key === 'requested_at' || key === 'reviewed_at') {
        return (new Date(av).getTime() - new Date(bv).getTime()) * factor;
      }
      return av.localeCompare(bv, undefined, { sensitivity: 'base' }) * factor;
    });
    return rows;
  }, [accessRequests, accessSort]);

  const filteredAccessRequests = useMemo(() => {
    const q = accessUserSearch.trim().toLowerCase();
    if (!q) return sortedAccessRequests;
    return sortedAccessRequests.filter((row) => {
      const name = (row.full_name || '').toLowerCase();
      const email = row.email.toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [sortedAccessRequests, accessUserSearch]);

  const accessSortActive = (key: AccessSortKey, dir: 'asc' | 'desc') =>
    accessSort.key === key && accessSort.dir === dir;

  const accessSortButtonClass = (active: boolean) =>
    `px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
      active ? 'bg-blue-600 text-white' : 'bg-slate-700/80 text-slate-300 hover:bg-slate-600'
    }`;

  const accessActionBtn =
    'flex w-full items-center justify-center h-5 px-1 text-[10px] leading-none font-medium rounded-[3px] whitespace-nowrap';
  const accessActionsCol = 'w-[7rem] min-w-[7rem] max-w-[7rem]';
  const accessTableBorder = 'border-r border-slate-700/80';
  const accessActionsHeadClass = `px-1 py-1.5 text-center text-[11px] font-semibold text-slate-400 whitespace-nowrap sticky top-0 right-0 z-30 ${accessActionsCol} bg-slate-900 border-b-2 border-b-slate-600 border-l-2 border-l-slate-600 ${accessTableBorder}`;
  const accessActionsCellClass = `px-1 py-1 align-top sticky right-0 z-10 ${accessActionsCol} bg-slate-800 border-b border-b-slate-700/80 border-l-2 border-l-slate-600 ${accessTableBorder}`;
  const accessTableHeadClass = `text-left px-2 py-1.5 text-[11px] font-semibold whitespace-nowrap sticky top-0 z-20 bg-slate-900 text-slate-400 border-b-2 border-b-slate-600 ${accessTableBorder}`;
  const accessTableRowClass = 'hover:bg-slate-900/40 group';
  const accessTableCellClass = `px-2 py-1.5 align-middle text-xs border-b border-b-slate-700/80 ${accessTableBorder}`;

  const renderAccessActions = (r: AccessRequestRow) => (
    <div className="flex flex-col gap-px w-full">
      {r.status !== 'approved' && (
        <button
          type="button"
          onClick={() => approveAccessRequest(r.id, r.email, r.full_name || '', false)}
          className={`${accessActionBtn} bg-emerald-700 hover:bg-emerald-600 text-white`}
        >
          Approve
        </button>
      )}
      {!r.is_admin && r.status !== 'approved' && (
        <button
          type="button"
          onClick={() =>
            void updateAccessUser(r.id, r.email, {
              is_event_manager: !(r.is_event_manager === true),
              notify_user: false,
            })
          }
          className={`${accessActionBtn} bg-amber-800 hover:bg-amber-700 text-white`}
        >
          {r.is_event_manager ? 'Revoke event mgr' : 'Event manager'}
        </button>
      )}
      {r.status !== 'approved' && (
        <button
          type="button"
          onClick={() => approveAccessRequest(r.id, r.email, r.full_name || '', true)}
          className={`${accessActionBtn} bg-blue-700 hover:bg-blue-600 text-white`}
        >
          Approve admin
        </button>
      )}
      {r.status !== 'pending' && (
        <button
          type="button"
          onClick={() => {
            if (confirm(`Set ${r.email} back to pending?`)) {
              void updateAccessUser(r.id, r.email, { status: 'pending', reset_account: true, notify_user: false });
            }
          }}
          className={`${accessActionBtn} bg-slate-600 hover:bg-slate-500 text-white`}
        >
          Pending
        </button>
      )}
      {r.status !== 'rejected' && (
        <button
          type="button"
          onClick={() => rejectAccessRequest(r.id, r.email)}
          className={`${accessActionBtn} bg-red-900/80 hover:bg-red-800 text-red-100`}
        >
          Reject
        </button>
      )}
      {r.status === 'approved' && (
        <button
          type="button"
          onClick={() => void openEventAccessModal(r)}
          className={`${accessActionBtn} gap-0.5 bg-violet-800 hover:bg-violet-700 text-white`}
          title="Choose which events this user can access"
        >
          <Calendar className="w-2 h-2 shrink-0" />
          Events
        </button>
      )}
      {r.status === 'approved' && !r.is_admin && (
        <button
          type="button"
          onClick={() =>
            void updateAccessUser(r.id, r.email, {
              dashboard_enabled: !(r.dashboard_enabled === true),
              notify_user: false,
            })
          }
          disabled={dashboardNeedsMigration}
          className={`${accessActionBtn} ${r.dashboard_enabled === true ? 'bg-cyan-800 hover:bg-cyan-700' : 'bg-slate-700 hover:bg-slate-600'} text-white disabled:opacity-50`}
          title={
            dashboardNeedsMigration
              ? 'Run migration 032 on Neon first'
              : 'Allow this user to open the Production Dashboard'
          }
        >
          {r.dashboard_enabled === true ? 'Dashboard on' : 'Dashboard off'}
        </button>
      )}
      {!r.is_admin && r.status === 'approved' && (
        <button
          type="button"
          onClick={() =>
            void updateAccessUser(r.id, r.email, {
              is_event_manager: !(r.is_event_manager === true),
              notify_user: false,
            })
          }
          className={`${accessActionBtn} bg-amber-800 hover:bg-amber-700 text-white`}
        >
          {r.is_event_manager ? 'Revoke event mgr' : 'Event manager'}
        </button>
      )}
      {r.status === 'approved' && (
        <button
          type="button"
          onClick={() => void updateAccessUser(r.id, r.email, { is_admin: !r.is_admin, notify_user: false })}
          className={`${accessActionBtn} bg-indigo-800 hover:bg-indigo-700 text-white`}
        >
          {r.is_admin ? 'Revoke admin' : 'Make admin'}
        </button>
      )}
      {r.portal_url && (
        <button
          type="button"
          onClick={() => openApprovalEmailDraft(r)}
          className={`${accessActionBtn} gap-0.5 bg-sky-800 hover:bg-sky-700 text-white`}
          title="Open a draft email in your mail app"
        >
          <Mail className="w-2 h-2 shrink-0" />
          Email
        </button>
      )}
      {r.portal_url && (
        <button
          type="button"
          onClick={() => void copyPortalLink(r.id, r.portal_url)}
          className={`${accessActionBtn} bg-slate-600 hover:bg-slate-500 text-white`}
          title="Copy portal link for this user"
        >
          {copiedPortalUserId === r.id ? 'Copied!' : 'Copy link'}
        </button>
      )}
      <button
        type="button"
        onClick={() => deleteAccessUser(r.id, r.email)}
        className={`${accessActionBtn} bg-slate-700 hover:bg-slate-600 text-slate-200`}
      >
        Delete
      </button>
    </div>
  );

  const accessSortIndicator = (key: AccessSortKey) =>
    accessSort.key === key ? (accessSort.dir === 'asc' ? ' ↑' : ' ↓') : '';

  const formatAccessDate = (value?: string | null) =>
    value ? new Date(value).toLocaleString() : '—';

  const accountSetupLabel = (row: AccessRequestRow) => {
    if (row.status !== 'approved') return '—';
    if (!row.neon_user_id) return 'Needs password';
    return 'Ready';
  };

  const copyPortalLink = async (userId: string, url?: string | null) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedPortalUserId(userId);
      window.setTimeout(() => setCopiedPortalUserId(null), 2500);
    } catch {
      setAccessRequestsError('Could not copy portal link.');
    }
  };

  const openApprovalEmailDraft = (row: AccessRequestRow) => {
    if (!row.portal_url) return;
    setAccessEmailCopied(false);
    setAccessEmailDraft({
      email: row.email,
      fullName: row.full_name || '',
      portalUrl: row.portal_url,
      isAdmin: !!row.is_admin,
    });
  };

  const copyApprovalEmailDraft = async () => {
    if (!accessEmailDraft) return;
    const draft = buildApprovalEmailDraft({
      fullName: accessEmailDraft.fullName,
      portalUrl: accessEmailDraft.portalUrl,
      isAdmin: accessEmailDraft.isAdmin,
    });
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      setAccessEmailCopied(true);
      window.setTimeout(() => setAccessEmailCopied(false), 2500);
    } catch {
      setAccessRequestsError('Could not copy email text.');
    }
  };

  const approvalEmailDraftContent = accessEmailDraft
    ? buildApprovalEmailDraft({
        fullName: accessEmailDraft.fullName,
        portalUrl: accessEmailDraft.portalUrl,
        isAdmin: accessEmailDraft.isAdmin,
      })
    : null;

  const approvalMailtoUrl =
    accessEmailDraft && approvalEmailDraftContent
      ? buildApprovalMailtoUrl(accessEmailDraft.email, approvalEmailDraftContent)
      : '';

  const fetchIntegrationTokens = useCallback(async () => {
    setIntegrationTokensLoading(true);
    setIntegrationTokensError(null);
    try {
      const res = await adminFetch('/api/admin/integration-tokens');
      if (res.status === 401) {
        setIntegrationTokensError('Unauthorized');
        setIntegrationTokens([]);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setIntegrationTokensError((err as { error?: string }).error || `HTTP ${res.status}`);
        setIntegrationTokens([]);
        return;
      }
      const data = (await res.json()) as {
        tokens?: typeof integrationTokens;
        needsMigration?: boolean;
      };
      if (data.needsMigration) {
        setIntegrationTokensError('Run migration 026 on Neon to enable API tokens.');
        setIntegrationTokens([]);
        return;
      }
      setIntegrationTokens(Array.isArray(data.tokens) ? data.tokens : []);
    } catch (e) {
      setIntegrationTokensError(e instanceof Error ? e.message : 'Request failed');
      setIntegrationTokens([]);
    } finally {
      setIntegrationTokensLoading(false);
    }
  }, []);

  useEffect(() => {
    if (createdTokenValue && createdTokenBannerRef.current) {
      createdTokenBannerRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [createdTokenValue]);

  const createIntegrationToken = useCallback(async () => {
    const name = newTokenName.trim();
    if (!name) return;
    setCreatingToken(true);
    setIntegrationTokensError(null);
    setCreatedTokenValue(null);
    setCreatedTokenCopied(false);
    try {
      const scopes = newTokenScopes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await adminFetch('/api/admin/integration-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          scopes,
          event_id: newTokenEventId.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIntegrationTokensError((data as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }
      setCreatedTokenValue((data as { token?: string }).token || null);
      setNewTokenName('');
      setNewTokenEventId('');
      await fetchIntegrationTokens();
    } catch (e) {
      setIntegrationTokensError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setCreatingToken(false);
    }
  }, [newTokenName, newTokenEventId, newTokenScopes, fetchIntegrationTokens]);

  const copyCreatedIntegrationToken = useCallback(async () => {
    if (!createdTokenValue) return;
    try {
      await navigator.clipboard.writeText(createdTokenValue);
      setCreatedTokenCopied(true);
      window.setTimeout(() => setCreatedTokenCopied(false), 2000);
    } catch {
      setIntegrationTokensError('Could not copy to clipboard — select the token and copy manually.');
    }
  }, [createdTokenValue]);

  const revokeIntegrationToken = useCallback(
    async (id: string, name: string) => {
      if (!confirm(`Revoke integration token "${name}"? Companion/vMix using it will stop working.`)) return;
      setIntegrationTokensError(null);
      try {
        const res = await adminFetch(`/api/admin/integration-tokens/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setIntegrationTokensError((data as { error?: string }).error || `HTTP ${res.status}`);
          return;
        }
        await fetchIntegrationTokens();
      } catch (e) {
        setIntegrationTokensError(e instanceof Error ? e.message : 'Request failed');
      }
    },
    [fetchIntegrationTokens]
  );

  const regenerateIntegrationToken = useCallback(
    async (id: string, name: string) => {
      if (
        !confirm(
          `Regenerate "${name}"? A new secret will be created with the same name and scopes. Update any apps using the old token.`
        )
      ) {
        return;
      }
      setIntegrationTokensError(null);
      setCreatedTokenCopied(false);
      try {
        const res = await adminFetch(`/api/admin/integration-tokens/${id}/regenerate`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setIntegrationTokensError((data as { error?: string }).error || `HTTP ${res.status}`);
          return;
        }
        setCreatedTokenValue((data as { token?: string }).token || null);
        await fetchIntegrationTokens();
      } catch (e) {
        setIntegrationTokensError(e instanceof Error ? e.message : 'Request failed');
      }
    },
    [fetchIntegrationTokens]
  );

  const deleteIntegrationToken = useCallback(
    async (id: string, name: string) => {
      if (!confirm(`Permanently delete revoked token "${name}"? This cannot be undone.`)) return;
      setIntegrationTokensError(null);
      try {
        const res = await adminFetch(`/api/admin/integration-tokens/${id}/permanent`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setIntegrationTokensError((data as { error?: string }).error || `HTTP ${res.status}`);
          return;
        }
        await fetchIntegrationTokens();
      } catch (e) {
        setIntegrationTokensError(e instanceof Error ? e.message : 'Request failed');
      }
    },
    [fetchIntegrationTokens]
  );

  const removeApprovedDomain = useCallback(async (domain: string) => {
    if (!confirm(`Remove domain "${domain}" from the approved list?`)) return;
    setApprovedDomainsError(null);
    try {
      const encoded = encodeURIComponent(domain);
      const res = await adminFetch(`/api/admin/approved-domains/${encoded}`, {
        method: 'DELETE',
      });
      if (res.status === 401) {
        setApprovedDomainsError('Unauthorized');
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; domains?: string[]; error?: string };
      if (!res.ok) {
        setApprovedDomainsError(data.error || `HTTP ${res.status}`);
        return;
      }
      if (data.ok && Array.isArray(data.domains)) {
        setApprovedDomains(data.domains);
      }
    } catch (e) {
      setApprovedDomainsError(e instanceof Error ? e.message : 'Request failed');
    }
  }, [fetchApprovedDomains]);

  useEffect(() => {
    if (!unlocked) return;
    fetchApprovedDomains();
    fetchIntegrationTokens();
    fetchAccessRequests();
    fetchPlatformMaintenance();
  }, [unlocked, fetchApprovedDomains, fetchIntegrationTokens, fetchAccessRequests, fetchPlatformMaintenance]);

  const disconnectUser = useCallback(async (eventId: string, userId: string) => {
    if (!confirm('Disconnect this user from the event? They will see a message and must return to the events list.')) return;
    setDisconnectingUserId(userId);
    try {
      const res = await adminFetch('/api/admin/disconnect-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, userId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert((err as { error?: string }).error || `Failed to disconnect (${res.status})`);
        return;
      }
      await fetchPresence();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setDisconnectingUserId(null);
    }
  }, [fetchPresence]);

  const fetchRunningTimers = useCallback(async () => {
    setRunningTimersLoading(true);
    setRunningTimersError(null);
    try {
      const res = await adminFetch('/api/admin/running-timers');
      if (res.status === 401) {
        setRunningTimersError('Unauthorized');
        setRunningTimers([]);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setRunningTimersError((err as { error?: string }).error || `HTTP ${res.status}`);
        setRunningTimers([]);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { timers?: RunningTimerRow[] };
      setRunningTimers(Array.isArray(data.timers) ? data.timers : []);
    } catch (e) {
      setRunningTimersError(e instanceof Error ? e.message : 'Request failed');
      setRunningTimers([]);
    } finally {
      setRunningTimersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    fetchRunningTimers();
    const interval = setInterval(fetchRunningTimers, 15_000);
    return () => clearInterval(interval);
  }, [unlocked, fetchRunningTimers]);

  const stopTimerForEvent = useCallback(async (eventId: string) => {
    setStoppingEventId(eventId);
    try {
      const res = await adminFetch('/api/admin/stop-timer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        console.error('Stop timer failed:', err.error);
        return;
      }
      await fetchRunningTimers();
    } finally {
      setStoppingEventId(null);
    }
  }, [fetchRunningTimers]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const key = password.trim();
    if (!key) {
      setError('Admin key required');
      return;
    }
    setIsLoggingIn(true);
    try {
      const res = await adminFetchWithCredentials(key, '/api/admin/puzzle-config');
      if (res.status === 401) {
        const body = (await res.json().catch(() => ({}))) as { reason?: string };
        const status = await fetchAdminAuthStatus(key);
        setError(describeAdminAuthFailure(status, body.reason));
        return;
      }
      if (res.status === 503) {
        setError('Admin API is not configured on the server');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!data.enabled) {
        setStoredAdminCredentials(key);
        sessionStorage.setItem(ADMIN_UNLOCK_KEY, '1');
        setUnlocked(true);
        setPassword('');
        return;
      }
      const count = data.count ? Math.max(1, Math.min(12, Number(data.count))) : 3;
      setPendingAdminKey(key);
      setPuzzleCount(count);
      setPuzzleShuffled(shuffleArray(PUZZLE_ALL_COLORS));
      setPuzzleSelected([]);
      setPuzzleError(null);
      setShowPuzzle(true);
      setPassword('');
    } catch {
      setError('Request failed. Check API connection.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handlePuzzleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPuzzleError(null);
    if (puzzleSelected.length !== puzzleCount || !pendingAdminKey) return;
    setPuzzleVerifying(true);
    try {
      const res = await adminFetchWithCredentials(
        pendingAdminKey,
        '/api/admin/puzzle-verify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ colors: puzzleSelected }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setStoredAdminCredentials(pendingAdminKey);
        sessionStorage.setItem(ADMIN_UNLOCK_KEY, '1');
        setUnlocked(true);
        setShowPuzzle(false);
        setPuzzleSelected([]);
        setPendingAdminKey('');
        return;
      }
      setPuzzleError(data.error || 'Wrong selection. Try again.');
    } catch {
      setPuzzleError('Request failed. Try again.');
    } finally {
      setPuzzleVerifying(false);
    }
  };

  const togglePuzzleColor = (colorName: string) => {
    setPuzzleSelected((prev) => {
      if (prev.includes(colorName)) return prev.filter((c) => c !== colorName);
      if (prev.length >= puzzleCount) return prev;
      return [...prev, colorName];
    });
  };

  const handleLock = () => {
    clearStoredAdminCredentials();
    setUnlocked(false);
    setPassword('');
    setPendingAdminKey('');
    setShowPuzzle(false);
    setPuzzleSelected([]);
    setError(null);
    setPuzzleError(null);
  };

  if (!unlocked) {
    if (authLoading) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
            <p className="text-slate-300">Loading…</p>
          </div>
        </div>
      );
    }

    if (isNeonAuthEnabled && !user) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
          <div className="bg-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-md border border-slate-700 text-center space-y-4">
            <h2 className="text-xl font-bold text-white">Admin</h2>
            <p className="text-slate-400 text-sm">Sign in with an administrator account to access this page.</p>
            <Link
              to="/"
              className="inline-block w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg"
            >
              Sign in
            </Link>
          </div>
        </div>
      );
    }

    if (isNeonAuthEnabled && accessStatus === 'pending') {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
          <div className="bg-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-md border border-slate-700 text-center space-y-4">
            <h2 className="text-xl font-bold text-white">Awaiting approval</h2>
            <p className="text-slate-400 text-sm">
              Your account ({user.email}) must be approved before you can use Admin.
            </p>
            <Link to="/" className="block text-sm text-blue-400 hover:text-blue-300">
              Back to app
            </Link>
          </div>
        </div>
      );
    }

    if (isNeonAuthEnabled && accessStatus === 'rejected') {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
          <div className="bg-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-md border border-slate-700 text-center space-y-4">
            <h2 className="text-xl font-bold text-white">Access declined</h2>
            <p className="text-slate-400 text-sm">Your access request was not approved.</p>
            <Link to="/" className="block text-sm text-blue-400 hover:text-blue-300">
              Back to app
            </Link>
          </div>
        </div>
      );
    }

    if (isNeonAuthEnabled && !neonAdminMaySignIn) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
          <div className="bg-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-md border border-slate-700 text-center space-y-4">
            <h2 className="text-xl font-bold text-white">Administrator access required</h2>
            <p className="text-slate-400 text-sm">
              {user
                ? `Signed in as ${user.email}, but this account is not an administrator.`
                : 'Sign in with an administrator account to access this page.'}
            </p>
            <Link to="/" className="block text-sm text-blue-400 hover:text-blue-300">
              Back to app
            </Link>
          </div>
        </div>
      );
    }

    if (showPuzzle) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
          <div className="bg-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-md border border-slate-700">
            <h2 className="text-xl font-bold text-white text-center mb-2">Admin</h2>
            <p className="text-slate-400 text-sm text-center mb-6">
              Select the {puzzleCount} correct colors
            </p>
            <form onSubmit={handlePuzzleSubmit} className="space-y-6">
              <div className="grid grid-cols-4 gap-3">
                {puzzleShuffled.map(({ name, bg, border }) => {
                  const selected = puzzleSelected.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => togglePuzzleColor(name)}
                      className={`aspect-square rounded-xl transition-all ${bg} border-2 ${selected ? `${border} ring-2 ring-white ring-offset-2 ring-offset-slate-800` : 'border-transparent opacity-90 hover:opacity-100'}`}
                      title={name}
                    />
                  );
                })}
              </div>
              {puzzleError && (
                <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-2 rounded-lg text-sm text-center">
                  {puzzleError}
                </div>
              )}
              <button
                type="submit"
                disabled={puzzleSelected.length !== puzzleCount || puzzleVerifying}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                {puzzleVerifying ? 'Checking…' : `Submit (${puzzleSelected.length}/${puzzleCount})`}
              </button>
              <button
                type="button"
                onClick={handleLock}
                className="w-full px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Back to login
              </button>
            </form>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-md border border-slate-700">
          <h2 className="text-xl font-bold text-white text-center mb-2">Admin</h2>
          {user?.email && (
            <p className="text-slate-400 text-sm text-center mb-4">Signed in as {user.email}</p>
          )}
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">
                Admin key
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                placeholder="Enter admin key"
                autoComplete="off"
                autoFocus
              />
            </div>
            {error && (
              <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              {isLoggingIn ? 'Checking…' : 'Continue'}
            </button>
          </form>
          <Link to="/" className="block text-center text-sm text-slate-400 hover:text-slate-300 mt-4">
            Back to app
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 scroll-smooth">
      <header className="sticky top-0 z-40 bg-slate-800/95 backdrop-blur border-b border-slate-700 px-4 sm:px-6 py-2.5 flex items-center gap-3">
        <h1 className="text-lg font-bold text-white shrink-0">Admin</h1>
        <nav
          className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Jump to section"
        >
          {ADMIN_NAV.map((item) => {
            const active = activeNavId === item.id;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  active
                    ? 'bg-slate-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/80'
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={handleLock}
          className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded-md transition-colors shrink-0"
        >
          Lock
        </button>
      </header>
      <main className="p-6 max-w-4xl mx-auto space-y-6">

        <section id="services" className="scroll-mt-16 bg-slate-800/80 rounded-xl border border-slate-700/80 p-6 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <h2 className="text-lg font-semibold text-white">Services</h2>
            <div className="flex items-center gap-3">
              {health?.timestamp && (
                <span className="text-slate-500 text-xs tabular-nums">
                  Updated {new Date(health.timestamp).toLocaleTimeString()}
                </span>
              )}
              <button
                type="button"
                onClick={fetchHealth}
                disabled={healthLoading}
                className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {healthLoading ? 'Checking…' : 'Refresh'}
              </button>
            </div>
          </div>
          {healthLoading && !health ? (
            <ul className="divide-y divide-slate-700/80 animate-pulse">
              {SERVICE_CONFIG.map(({ key }) => (
                <li key={key} className="py-4 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-slate-700" />
                    <div className="h-4 w-24 bg-slate-700 rounded" />
                  </div>
                  <div className="h-6 w-20 bg-slate-700 rounded-full" />
                </li>
              ))}
            </ul>
          ) : health?.services ? (
            <>
              {health.error && (
                <div className="mb-4 px-4 py-2 rounded-lg bg-red-900/30 border border-red-800/50 text-red-300 text-sm">
                  {health.error}
                </div>
              )}
              <ul className="divide-y divide-slate-700/80">
                {SERVICE_CONFIG.map(({ key, icon: Icon, label, desc, iconColor }) => {
                  const svc = health.services?.[key];
                  const level = serviceLevel(key, svc);
                  const apiBase = key === 'railway' ? getApiBaseUrl() : '';
                  const statusLabel = serviceStatusLabel(level, svc);
                  return (
                    <li key={key} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${iconColorClasses(level, iconColor)}`}>
                          <Icon className="w-4 h-4" strokeWidth={2} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="font-semibold text-white">{label}</span>
                            <span className="text-slate-500 text-sm">{desc}</span>
                          </div>
                          {key === 'neon' && svc?.dbName && (
                            <p className="text-slate-400 text-xs mt-1 font-mono truncate" title={svc.dbName}>DB: {svc.dbName}</p>
                          )}
                          {key === 'railway' && (apiBase || svc?.nodeVersion || typeof svc?.uptimeSeconds === 'number' || svc?.env) && (
                            <p
                              className="text-slate-400 text-xs mt-1 truncate"
                              title={[apiBase, svc?.nodeVersion && `Node ${svc.nodeVersion}`, typeof svc?.uptimeSeconds === 'number' && `Uptime ${formatUptime(svc.uptimeSeconds)}`, svc?.env].filter(Boolean).join(' · ')}
                            >
                              {apiBase && <span className="font-mono">{apiBase.replace(/^https?:\/\//, '')}</span>}
                              {svc?.nodeVersion && <span className="ml-2"> · Node {svc.nodeVersion}</span>}
                              {typeof svc?.uptimeSeconds === 'number' && <span> · Uptime {formatUptime(svc.uptimeSeconds)}</span>}
                              {svc?.env && <span> · {svc.env}</span>}
                            </p>
                          )}
                          {key === 'upstash' && (svc?.latencyMs != null || svc?.error || svc?.configured === false) && (
                            <p className="text-slate-400 text-xs mt-1 truncate">
                              {svc.configured === false
                                ? 'Env vars not set'
                                : svc.latencyMs != null
                                  ? `Ping ${svc.latencyMs} ms`
                                  : null}
                              {svc.error ? <span>{svc.latencyMs != null ? ' · ' : ''}{svc.error}</span> : null}
                            </p>
                          )}
                          {(key === 'netlify' || key === 'resend') && svc?.description && (
                            <p className="text-slate-400 text-xs mt-1 truncate" title={svc.description}>
                              {svc.description}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${statusPillClasses(level)}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusDotClasses(level)}`} />
                        {statusLabel}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="text-slate-400 text-sm">No status yet. Click Refresh.</p>
          )}
        </section>

        <section id="platform" className="scroll-mt-16 bg-slate-800/80 rounded-xl border border-slate-700/80 p-6 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Wrench className="w-5 h-5 text-slate-400" />
                Platform maintenance
              </h2>
              <p className="text-slate-500 text-sm mt-1">
                Simple health check for the software versions that run your site and API — and when they need upgrading.
                Admins are emailed when something is Review or Urgent (at most about once per day while it stays open).
              </p>
            </div>
            <div className="flex items-center gap-3">
              {platformReport?.checkedAt && (
                <span className="text-slate-500 text-xs tabular-nums">
                  Checked {new Date(platformReport.checkedAt).toLocaleString()}
                </span>
              )}
              <button
                type="button"
                onClick={fetchPlatformMaintenance}
                disabled={platformLoading}
                className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {platformLoading ? 'Checking…' : 'Refresh dates'}
              </button>
            </div>
          </div>

          {platformError && (
            <div className="mb-4 px-4 py-2 rounded-lg bg-red-900/30 border border-red-800/50 text-red-300 text-sm">
              {platformError}
            </div>
          )}

          {platformLoading && !platformReport ? (
            <div className="animate-pulse space-y-3">
              <div className="h-10 bg-slate-700/80 rounded-lg" />
              <div className="h-16 bg-slate-700/60 rounded-lg" />
              <div className="h-16 bg-slate-700/60 rounded-lg" />
            </div>
          ) : platformReport ? (
            <>
              <div
                className={`mb-5 rounded-xl border px-4 py-3 ${
                  platformReport.summary.level === 'ok'
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : platformReport.summary.level === 'critical'
                      ? 'border-red-500/30 bg-red-500/10'
                      : 'border-amber-500/30 bg-amber-500/10'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${platformLevelPill(platformReport.summary.level)}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${platformLevelDot(platformReport.summary.level)}`} />
                    {platformReport.summary.audienceLabel || platformReport.summary.level}
                  </span>
                  <p className="text-white font-medium text-sm sm:text-base">
                    {platformReport.summary.headline || 'Platform status'}
                  </p>
                </div>
                <p className="text-slate-400 text-xs mt-2">
                  {platformReport.eolNote ||
                    'Support end dates update when you click Refresh dates (from endoflife.date).'}
                </p>
              </div>

              {platformReport.recommendations && platformReport.recommendations.length > 0 && (
                <div className="mb-5 rounded-xl border border-slate-600/80 bg-slate-900/40 p-4">
                  <h3 className="text-sm font-semibold text-white mb-3">What to do</h3>
                  <ul className="space-y-3">
                    {platformReport.recommendations.map((rec) => (
                      <li
                        key={rec.id}
                        className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_11rem] gap-2 sm:gap-4 text-sm items-start"
                      >
                        <div>
                          <div className="font-medium text-slate-200">{rec.title}</div>
                          <p className="text-slate-400 mt-0.5">{rec.action}</p>
                        </div>
                        <div className="sm:text-right">
                          <div className="inline-block rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 min-w-[9.5rem] sm:ml-auto">
                            <div className="text-[10px] uppercase tracking-wide text-amber-200/80">
                              {rec.recommendByLabel || 'Target'}
                            </div>
                            <div className="text-sm font-semibold text-amber-100 tabular-nums mt-0.5">
                              {rec.recommendByDisplay || '—'}
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <h3 className="text-sm font-semibold text-slate-300 mb-2">Status checklist</h3>
              <ul className="divide-y divide-slate-700/80">
                {platformReport.checks.map((check) => {
                  const dateRight =
                    check.dateRight ||
                    (check.recommendBy
                      ? new Date(`${check.recommendBy}T12:00:00.000Z`).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          timeZone: 'UTC',
                        })
                      : null);
                  return (
                    <li
                      key={check.id}
                      className="py-4 first:pt-0 last:pb-0 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_11rem] gap-3 sm:gap-4 items-start"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-semibold text-white">{check.title}</span>
                          {check.value != null && check.value !== '' && (
                            <span className="text-slate-500 text-xs font-mono">{check.value}</span>
                          )}
                        </div>
                        {check.whatIsThis && (
                          <p className="text-slate-500 text-xs mt-1 leading-relaxed">{check.whatIsThis}</p>
                        )}
                        <p className="text-slate-300 text-sm mt-1.5 leading-relaxed">
                          {check.plain || check.detail}
                        </p>
                        {check.action && (
                          <p className="text-slate-400 text-sm mt-2">
                            <span className="text-slate-500">Action: </span>
                            {check.action}
                          </p>
                        )}
                      </div>
                      <div className="sm:text-right flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${platformLevelPill(check.level)}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${platformLevelDot(check.level)}`} />
                          {check.label === 'Good' || check.label === 'Review' || check.label === 'Urgent'
                            ? check.label
                            : check.level === 'ok'
                              ? 'Good'
                              : check.level === 'critical'
                                ? 'Urgent'
                                : check.level === 'warning'
                                  ? 'Review'
                                  : check.label}
                        </span>
                        {dateRight ? (
                          <div className="rounded-lg border border-slate-600/80 bg-slate-900/50 px-2.5 py-1.5 min-w-[9.5rem]">
                            <div className="text-[10px] uppercase tracking-wide text-slate-500">
                              {check.recommendByLabel || 'Date'}
                            </div>
                            <div className="text-sm font-semibold text-sky-300 tabular-nums leading-tight mt-0.5">
                              {dateRight}
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-slate-600 sm:mt-1">No date needed</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {(platformReport.links?.nodeEol || platformReport.links?.nodeReleases) && (
                <p className="mt-4 text-slate-500 text-xs">
                  Official schedules:{' '}
                  {platformReport.links.nodeEol && (
                    <a
                      href={platformReport.links.nodeEol}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline"
                    >
                      Node end-of-life dates
                    </a>
                  )}
                  {platformReport.links.nodeEol && platformReport.links.nodeReleases ? ' · ' : ''}
                  {platformReport.links.nodeReleases && (
                    <a
                      href={platformReport.links.nodeReleases}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-400 hover:text-sky-300 underline-offset-2 hover:underline"
                    >
                      Node release schedule
                    </a>
                  )}
                </p>
              )}
            </>
          ) : (
            <p className="text-slate-400 text-sm">No report yet. Click Refresh dates.</p>
          )}
        </section>

        <section id="timers" className="scroll-mt-16 bg-slate-800/80 rounded-xl border border-slate-700/80 p-6 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Timer className="w-5 h-5 text-slate-400" />
              Running timers
            </h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={fetchRunningTimers}
                disabled={runningTimersLoading}
                className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {runningTimersLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
          <p className="text-slate-500 text-sm mb-4">Events with a timer currently running (refreshes every 15s). Stop them from here.</p>
          {runningTimersError && (
            <div className="mb-4 px-4 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-200 text-sm">
              Error: {runningTimersError}
            </div>
          )}
          {runningTimersLoading && runningTimers.length === 0 && !runningTimersError ? (
            <p className="text-slate-400 text-sm">Loading…</p>
          ) : runningTimers.length === 0 ? (
            <p className="text-slate-400 text-sm">No running timers. Timers appear when someone has started a countdown on Run of Show.</p>
          ) : (
            <ul className="space-y-3">
              {runningTimers.map((t) => (
                <li key={t.eventId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700/80 bg-slate-800/60 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-medium text-white truncate">{t.eventName}</div>
                    <div className="text-slate-400 text-sm">
                      {t.cueIs}
                      {t.durationSeconds != null && (
                        <span className="ml-2"> · {Math.floor(t.durationSeconds / 60)}m</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => stopTimerForEvent(t.eventId)}
                    disabled={stoppingEventId === t.eventId}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600/80 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                    title="Stop timer for this event"
                  >
                    <Square className="w-3.5 h-3.5" />
                    {stoppingEventId === t.eventId ? 'Stopping…' : 'Stop'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="presence" className="scroll-mt-16 bg-slate-800/80 rounded-xl border border-slate-700/80 p-6 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-slate-400" />
              Events & users
            </h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={fetchPresence}
                disabled={presenceLoading}
                className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {presenceLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
          <p className="text-slate-500 text-sm mb-4">Active events and viewers (refreshes every 15s)</p>
          {presenceError && (
            <div className="mb-4 px-4 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-200 text-sm">
              Error loading presence: {presenceError}
            </div>
          )}
          {presenceLoading && presence.length === 0 && !presenceError ? (
            <p className="text-slate-400 text-sm">Loading…</p>
          ) : presence.length === 0 ? (
            <p className="text-slate-400 text-sm">
              No active events or viewers. Viewers appear when someone has Run of Show open for an event (same API as this admin page).
            </p>
          ) : (
            <ul className="space-y-4">
              {presence.map((ev) => (
                <li key={ev.eventId} className="rounded-lg border border-slate-700/80 bg-slate-800/60 p-4">
                  <div className="font-medium text-white mb-2">
                    {ev.eventName}
                    <span className="text-slate-500 font-normal text-sm ml-2">({ev.eventId})</span>
                  </div>
                  {(ev.viewers ?? []).length === 0 ? (
                    <p className="text-slate-500 text-sm">No viewers</p>
                  ) : (
                    <ul className="divide-y divide-slate-700/60">
                      {(ev.viewers ?? []).map((v, i) => (
                        <li key={`${ev.eventId}-${v.userId}-${i}`} className="py-2 first:pt-0 last:pb-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <span className="text-white font-medium">{v.userName || v.userEmail || v.userId}</span>
                          {v.userEmail && v.userName !== v.userEmail && (
                            <span className="text-slate-400 truncate">{v.userEmail}</span>
                          )}
                          <span className="text-slate-500 text-xs px-2 py-0.5 rounded bg-slate-700/80">{v.userRole}</span>
                          <button
                            type="button"
                            onClick={() => disconnectUser(ev.eventId, v.userId)}
                            disabled={disconnectingUserId === v.userId}
                            className="ml-auto px-2 py-1 text-xs font-medium rounded bg-amber-700/80 text-amber-200 hover:bg-amber-600 disabled:opacity-50"
                            title="Disconnect this user from the event"
                          >
                            {disconnectingUserId === v.userId ? 'Disconnecting…' : 'Disconnect'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="access" className="scroll-mt-16 bg-slate-800/80 rounded-xl border border-slate-700/80 p-6 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-slate-400" />
              User access
            </h2>
            <button
              type="button"
              onClick={fetchAccessRequests}
              disabled={accessRequestsLoading}
              className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {accessRequestsLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          <p className="text-slate-500 text-sm mb-4">
            View all access requests, change status, and remove users. Copy a user&apos;s portal link to send it manually
            (Teams, Slack, etc.) when email is not available. Deleting removes the app access record and API sessions.
          </p>

          <div className="flex flex-wrap gap-2 mb-4">
            {(['all', 'pending', 'approved', 'rejected'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setAccessStatusFilter(filter)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  accessStatusFilter === filter
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700/80 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <input
              type="search"
              value={accessUserSearch}
              onChange={(e) => setAccessUserSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="flex-1 min-w-[14rem] px-3 py-2 bg-slate-900/60 border border-slate-600 rounded-lg text-sm text-white placeholder:text-slate-500"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500 text-xs uppercase tracking-wide">Sort</span>
              <button
                type="button"
                onClick={() => setAccessSort({ key: 'full_name', dir: 'asc' })}
                className={accessSortButtonClass(accessSortActive('full_name', 'asc'))}
              >
                Name A–Z
              </button>
              <button
                type="button"
                onClick={() => setAccessSort({ key: 'requested_at', dir: 'desc' })}
                className={accessSortButtonClass(accessSortActive('requested_at', 'desc'))}
              >
                Newest
              </button>
              <button
                type="button"
                onClick={() => setAccessSort({ key: 'requested_at', dir: 'asc' })}
                className={accessSortButtonClass(accessSortActive('requested_at', 'asc'))}
              >
                Oldest
              </button>
            </div>
          </div>

          {accessRequestsError && (
            <div className="mb-4 px-4 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-200 text-sm">
              {accessRequestsError}
            </div>
          )}

          {dashboardNeedsMigration && (
            <div className="mb-4 px-4 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-200 text-sm">
              Run migration <code className="font-mono text-amber-100">032_add_dashboard_enabled.sql</code> on
              Neon, then redeploy Railway, to enable per-user Production Dashboard access.
            </div>
          )}

          {filteredAccessRequests.length === 0 ? (
            <p className="text-slate-400 text-sm">
              {accessUserSearch.trim()
                ? `No users match "${accessUserSearch.trim()}".`
                : accessStatusFilter === 'all'
                  ? 'No users found.'
                  : `No ${accessStatusFilter} users.`}
            </p>
          ) : (
            <div className="rounded-lg border border-slate-600 overflow-hidden">
              <div className="overflow-auto max-h-[min(32rem,calc(100vh-14rem))]">
                <table className="min-w-full text-xs border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className={accessTableHeadClass}>
                        <button
                          type="button"
                          onClick={() => toggleAccessSort('full_name')}
                          className={`hover:text-white ${accessSort.key === 'full_name' ? 'text-white' : ''}`}
                        >
                          Name{accessSortIndicator('full_name')}
                        </button>
                      </th>
                      <th className={accessTableHeadClass}>
                        <button
                          type="button"
                          onClick={() => toggleAccessSort('email')}
                          className={`hover:text-white ${accessSort.key === 'email' ? 'text-white' : ''}`}
                        >
                          Email{accessSortIndicator('email')}
                        </button>
                      </th>
                      <th className={accessTableHeadClass}>
                        <button
                          type="button"
                          onClick={() => toggleAccessSort('status')}
                          className={`hover:text-white ${accessSort.key === 'status' ? 'text-white' : ''}`}
                        >
                          Status{accessSortIndicator('status')}
                        </button>
                      </th>
                      <th className={accessTableHeadClass}>Role</th>
                      <th className={accessTableHeadClass}>Dashboard</th>
                      <th className={accessTableHeadClass}>Events</th>
                      <th className={accessTableHeadClass}>Account</th>
                      <th className={accessTableHeadClass}>
                        <button
                          type="button"
                          onClick={() => toggleAccessSort('requested_at')}
                          className={`hover:text-white ${accessSort.key === 'requested_at' ? 'text-white' : ''}`}
                        >
                          Requested{accessSortIndicator('requested_at')}
                        </button>
                      </th>
                      <th className={accessTableHeadClass}>
                        <button
                          type="button"
                          onClick={() => toggleAccessSort('reviewed_at')}
                          className={`hover:text-white ${accessSort.key === 'reviewed_at' ? 'text-white' : ''}`}
                        >
                          Reviewed{accessSortIndicator('reviewed_at')}
                        </button>
                      </th>
                      <th className={accessActionsHeadClass}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccessRequests.map((r) => (
                      <tr key={r.id} className={accessTableRowClass}>
                        <td className={`${accessTableCellClass} text-white`}>{r.full_name || '—'}</td>
                        <td className={`${accessTableCellClass} text-slate-300`}>{r.email}</td>
                        <td className={accessTableCellClass}>
                          <span
                            className={`inline-flex px-1.5 py-px rounded text-[10px] font-medium ${
                              r.status === 'approved'
                                ? 'bg-emerald-900/50 text-emerald-200'
                                : r.status === 'rejected'
                                  ? 'bg-red-900/50 text-red-200'
                                  : 'bg-amber-900/50 text-amber-200'
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className={`${accessTableCellClass} text-slate-300`}>
                          {r.is_admin ? 'Admin' : r.is_event_manager ? 'Event manager' : 'User'}
                        </td>
                        <td className={`${accessTableCellClass} text-slate-400`}>
                          {r.status === 'approved' ? (
                            r.is_admin ? (
                              'Always (admin)'
                            ) : r.dashboard_enabled === true ? (
                              <span className="text-cyan-300">On</span>
                            ) : (
                              'Off'
                            )
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className={`${accessTableCellClass} text-slate-400`}>
                          {r.status === 'approved' ? (
                            r.is_admin ? (
                              'All (admin)'
                            ) : (r.event_access_count ?? 0) === 0 ? (
                              'All events'
                            ) : (
                              `${r.event_access_count} selected`
                            )
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className={`${accessTableCellClass} text-slate-400`}>{accountSetupLabel(r)}</td>
                        <td className={`${accessTableCellClass} text-slate-400 whitespace-nowrap`}>
                          {formatAccessDate(r.requested_at)}
                        </td>
                        <td className={`${accessTableCellClass} text-slate-400 whitespace-nowrap`}>
                          {formatAccessDate(r.reviewed_at)}
                        </td>
                        <td className={`${accessActionsCellClass} group-hover:bg-slate-900`}>
                          {renderAccessActions(r)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-3 py-2 text-xs text-slate-500 border-t border-slate-700/60 bg-slate-900/40">
                {accessUserSearch.trim()
                  ? `${filteredAccessRequests.length} of ${sortedAccessRequests.length} users`
                  : `${filteredAccessRequests.length} user${filteredAccessRequests.length === 1 ? '' : 's'}`}
                {' — scroll for more'}
              </p>
            </div>
          )}
        </section>

        <section id="tokens" className="scroll-mt-16 bg-slate-800/80 rounded-xl border border-slate-700/80 p-6 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Key className="w-5 h-5 text-slate-400" />
              Integration API tokens
            </h2>
            <button
              type="button"
              onClick={fetchIntegrationTokens}
              disabled={integrationTokensLoading}
              className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {integrationTokensLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          <p className="text-slate-500 text-sm mb-4">
            Scoped tokens for Bitfocus Companion, Spout, and other integrations. Use scopes{' '}
            <code className="text-slate-400">read,control</code> for Companion on one event. The full secret is shown
            once when you create or regenerate a token — copy it then. Use Regenerate if you lose it.
          </p>
          {integrationTokensError && (
            <div className="mb-4 px-4 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-200 text-sm">
              {integrationTokensError}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 mb-4">
            <input
              type="text"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              placeholder="Token name (e.g. Companion - Main Stage)"
              className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm"
            />
            <input
              type="text"
              value={newTokenEventId}
              onChange={(e) => setNewTokenEventId(e.target.value)}
              placeholder="Event ID (optional — limits token to one event)"
              className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm font-mono"
            />
            <input
              type="text"
              value={newTokenScopes}
              onChange={(e) => setNewTokenScopes(e.target.value)}
              placeholder="Scopes: read,control,write,backup:export"
              className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm sm:col-span-2"
            />
          </div>
          <button
            type="button"
            onClick={createIntegrationToken}
            disabled={creatingToken || !newTokenName.trim()}
            className="mb-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg"
          >
            {creatingToken ? 'Creating…' : 'Create token'}
          </button>
          {createdTokenValue ? (
            <div
              ref={createdTokenBannerRef}
              className="mb-4 px-4 py-3 rounded-lg bg-emerald-900/30 border border-emerald-700/50 text-emerald-100 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <p className="font-medium">Copy this token now — it will not be shown again:</p>
                <button
                  type="button"
                  onClick={() => void copyCreatedIntegrationToken()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  {createdTokenCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy token
                    </>
                  )}
                </button>
              </div>
              <code className="block break-all text-xs bg-slate-900/60 p-2 rounded select-all">
                {createdTokenValue}
              </code>
            </div>
          ) : null}
          {integrationTokens.length === 0 ? (
            <p className="text-slate-400 text-sm">No integration tokens yet.</p>
          ) : (
            <ul className="divide-y divide-slate-700/60 rounded-lg border border-slate-700/80">
              {integrationTokens.map((t) => (
                <li key={t.id} className="px-4 py-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-white">{t.name}</span>
                  <code className="text-xs text-slate-400">{t.token_prefix}…</code>
                  <span className="text-slate-500">{(t.scopes || []).join(', ')}</span>
                  {t.event_id && <span className="text-slate-500 font-mono text-xs">{t.event_id}</span>}
                  {t.revoked_at ? (
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      <span className="text-red-400 text-xs">revoked</span>
                      <button
                        type="button"
                        onClick={() => regenerateIntegrationToken(t.id, t.name)}
                        className="text-xs text-sky-300 hover:text-sky-200"
                      >
                        Regenerate
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteIntegrationToken(t.id, t.name)}
                        className="text-xs text-red-300 hover:text-red-200"
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => regenerateIntegrationToken(t.id, t.name)}
                        className="text-xs text-sky-300 hover:text-sky-200"
                      >
                        Regenerate
                      </button>
                      <button
                        type="button"
                        onClick={() => revokeIntegrationToken(t.id, t.name)}
                        className="text-xs text-amber-300 hover:text-amber-200"
                      >
                        Revoke
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="domains" className="scroll-mt-16 bg-slate-800/80 rounded-xl border border-slate-700/80 p-6 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Mail className="w-5 h-5 text-slate-400" />
              Approved email domains
            </h2>
            <button
              type="button"
              onClick={fetchApprovedDomains}
              disabled={approvedDomainsLoading}
              className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {approvedDomainsLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          <p className="text-slate-500 text-sm mb-4">
            Only users with these email domains can sign in. Empty = allow all. {approvedDomainInputHint()}
          </p>
          {domainsNeedsMigration && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-200 text-sm flex flex-wrap items-center gap-3">
              <span>The approved-domains table is missing on this database. Run migration 024 or sync it here.</span>
              <button
                type="button"
                onClick={syncApprovedDomainsTable}
                disabled={domainsSyncingTable}
                className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {domainsSyncingTable ? 'Syncing…' : 'Sync table'}
              </button>
            </div>
          )}
          {approvedDomainsError && (
            <div className="mb-4 px-4 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-200 text-sm">
              {approvedDomainsError}
            </div>
          )}
          <form
            className="flex flex-wrap gap-2 mb-4"
            onSubmit={(e) => {
              e.preventDefault();
              void addApprovedDomain();
            }}
          >
            <input
              type="text"
              value={addDomainInput}
              onChange={(e) => setAddDomainInput(e.target.value)}
              placeholder="e.g. company.com"
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 font-mono text-sm w-48"
            />
            <button
              type="submit"
              disabled={addDomainLoading || !addDomainInput.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {addDomainLoading ? 'Adding…' : 'Add domain'}
            </button>
          </form>
          {approvedDomainsLoading && approvedDomains.length === 0 && !approvedDomainsError ? (
            <p className="text-slate-400 text-sm">Loading…</p>
          ) : approvedDomains.length === 0 ? (
            <p className="text-slate-400 text-sm">No domains configured. All email domains are allowed.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {approvedDomains.map((d) => (
                <li key={d} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700/80 border border-slate-600 text-white text-sm font-mono">
                  {d}
                  <button
                    type="button"
                    onClick={() => removeApprovedDomain(d)}
                    className="text-slate-400 hover:text-red-400 focus:outline-none"
                    title={`Remove ${d}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="backup" className="scroll-mt-16 bg-slate-800/80 rounded-xl border border-slate-700/80 p-6 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-slate-400" />
              Google Drive weekly backup
            </h2>
            <button
              type="button"
              onClick={fetchBackupConfig}
              disabled={backupConfigLoading}
              className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {backupConfigLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          <p className="text-slate-500 text-sm mb-4">
            Backs up <strong>upcoming</strong> events (event date ≥ today) to a <strong>weekly subfolder</strong> (e.g. 2026-W06) in your Drive folder. <strong>Run backup now</strong> works with or without the weekly checkbox—you only need folder ID and API credentials.
          </p>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-slate-400 text-sm">Table schema (API&apos;s DB / Neon branch):</span>
            <button
              type="button"
              onClick={syncBackupTable}
              disabled={backupSyncingTable}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              title="Create table if missing, or add missing columns (e.g. gdrive_service_account_json). Safe to run anytime."
            >
              {backupSyncingTable ? 'Syncing…' : 'Sync table (create or update schema)'}
            </button>
          </div>
          <details className="mb-4 text-sm">
            <summary className="cursor-pointer text-slate-400 hover:text-slate-300 focus:outline-none focus:text-slate-300">
              How to set up Google Drive and the API
            </summary>
            <div className="mt-2 pl-4 border-l-2 border-slate-600 text-slate-400 space-y-2">
              <p><strong className="text-slate-300">1. Google Cloud:</strong> Create a project → enable <strong>Google Drive API</strong> → Credentials → Create <strong>Service account</strong> → Add key (JSON). Note the <code className="bg-slate-700 px-1 rounded">client_email</code> from the JSON.</p>
              <p><strong className="text-slate-300">2. Drive folder (Shared Drive required):</strong> Service accounts have no storage in &quot;My Drive&quot;. Create a <strong>Shared Drive</strong> (or use an existing one), create a folder inside it, add the service account email as <strong>Editor</strong>. Use that folder&apos;s ID from the URL: <code className="bg-slate-700 px-1 rounded">drive.google.com/drive/folders/FOLDER_ID</code>.</p>
              <p><strong className="text-slate-300">3. Credentials:</strong> Paste the JSON key in <strong>Service account JSON</strong> below and Save, or set <code className="bg-slate-700 px-1 rounded">GOOGLE_SERVICE_ACCOUNT_JSON</code> in API env (e.g. Railway).</p>
              <p><strong className="text-slate-300">4. Admin:</strong> Paste the folder ID → Save → use <strong>Run backup now</strong> (works with or without &quot;Enable weekly backup&quot;).</p>
              <p className="text-xs text-slate-500">Full steps: <code className="bg-slate-700 px-1 rounded">docs/GOOGLE-DRIVE-BACKUP-SETUP.md</code></p>
              <p className="text-xs text-slate-500 mt-1">Alternative (no Drive API from app): use a scheduled Google Apps Script — see the section below.</p>
            </div>
          </details>
          <details className="mb-4 text-sm bg-emerald-900/20 border border-emerald-700/40 rounded-lg overflow-hidden">
            <summary className="cursor-pointer px-4 py-3 text-emerald-200 hover:text-emerald-100 focus:outline-none font-medium">
              Weekly backup via Google Apps Script (no Drive API / no service account)
            </summary>
            <div className="px-4 pb-4 pt-1 border-t border-emerald-700/30 text-slate-300 space-y-3">
              <p className="text-sm">
                Use a <strong className="text-white">Google Apps Script</strong> that runs on a schedule (e.g. weekly). The script calls your Railway API, gets upcoming events, and writes CSV files to your Google Drive using your own Google account. No service account, no folder sharing with a bot.
              </p>
              <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">Setup</p>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>Go to <a href="https://script.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">script.google.com</a> → <strong>New project</strong>.</li>
                <li>Delete the default code and paste the script below (use <strong>Copy script</strong>).</li>
                <li>At the top of the script, set <strong>CONFIG</strong>: <code className="bg-slate-700 px-1 rounded">API_BASE_URL</code> (your Railway API URL), <code className="bg-slate-700 px-1 rounded">API_KEY</code> (same as Admin key), and optionally <code className="bg-slate-700 px-1 rounded">DRIVE_FOLDER_ID</code> (leave empty for My Drive root).</li>
                <li>Run <strong>testBackupConnection</strong> once (dropdown → testBackupConnection → Run). Check View → Logs; you should see e.g. &quot;OK: API returned N upcoming event(s).&quot;</li>
                <li>Run <strong>runBackupToDrive</strong> once and authorize Drive when prompted. Check your Drive for a weekly folder (e.g. 2026-W06) with CSVs.</li>
                <li><strong className="text-emerald-200">Set the timed trigger:</strong> Click the <strong>Triggers</strong> (clock) icon in the left sidebar → <strong>Add Trigger</strong> → Function: <code className="bg-slate-700 px-1 rounded">runBackupToDrive</code> → Event: <strong>Time-driven</strong> → Type: <strong>Week timer</strong> → Choose day and time (e.g. Monday 6:00 am). Save.</li>
              </ol>
              <div className="relative">
                <pre className="bg-slate-900 border border-slate-600 rounded-lg p-4 text-xs text-slate-300 overflow-x-auto max-h-80 overflow-y-auto font-mono whitespace-pre">
                  <code>{GOOGLE_APPS_SCRIPT_BACKUP_SOURCE}</code>
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_BACKUP_SOURCE);
                    setScriptCopied(true);
                    setTimeout(() => setScriptCopied(false), 2000);
                  }}
                  className="absolute top-2 right-2 flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded border border-slate-600 transition-colors"
                >
                  {scriptCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {scriptCopied ? 'Copied' : 'Copy script'}
                </button>
              </div>
              <p className="text-slate-500 text-xs">
                Full guide: <code className="bg-slate-700 px-1 rounded">docs/BACKUP-VIA-GOOGLE-APPS-SCRIPT.md</code> (in repo).
              </p>
            </div>
          </details>
          {backupConfig.needsMigration && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-blue-900/30 border border-blue-700/50 text-blue-200 text-sm space-y-2">
              <p>
                <strong>API doesn&apos;t see the table yet.</strong> Click <strong>Sync table (create or update schema)</strong> above to create or fix the table in the API&apos;s database (same as running migrations 022 + 023). Or run the SQL in Neon on the correct branch, then Verify.
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={checkBackupTable}
                  className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white text-xs rounded transition-colors"
                >
                  Verify table
                </button>
                {backupTableCheck !== null && !backupTableCheck.exists && (
                  <button
                    type="button"
                    onClick={createBackupTable}
                    disabled={backupCreatingTable}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs rounded transition-colors"
                  >
                    {backupCreatingTable ? 'Creating…' : 'Create table now'}
                  </button>
                )}
              </div>
              {backupTableCheck !== null && (
                <p className="text-xs mt-1">
                  API sees table: <strong>{backupTableCheck.exists ? 'Yes' : 'No'}</strong>
                  {backupTableCheck.error && ` — ${backupTableCheck.error}`}
                </p>
              )}
            </div>
          )}
          {backupConfigError && (
            <div className="mb-4 px-4 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-200 text-sm">
              {backupConfigError}
            </div>
          )}
          {backupConfigLoading && !backupConfig.folderId && !backupConfigError && !backupConfig.needsMigration ? (
            <p className="text-slate-400 text-sm">Loading…</p>
          ) : (
            <div className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={backupConfig.enabled}
                  onChange={(e) => setBackupConfig((c) => ({ ...c, enabled: e.target.checked }))}
                  className="rounded border-slate-500 bg-slate-700 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-white text-sm">Enable weekly backup to Google Drive</span>
              </label>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Drive folder ID</label>
                <input
                  type="text"
                  value={backupFolderIdInput}
                  onChange={(e) => setBackupFolderIdInput(e.target.value)}
                  placeholder="e.g. 1ABC123xyz..."
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 font-mono text-sm"
                />
                <p className="text-slate-500 text-xs mt-1">
                  From the folder URL: drive.google.com/drive/folders/<strong className="text-slate-400">FOLDER_ID</strong>
                </p>
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">
                  Service account JSON {backupConfig.hasServiceAccount && <span className="text-emerald-400 font-normal">(set)</span>}
                </label>
                <textarea
                  value={backupServiceAccountInput}
                  onChange={(e) => setBackupServiceAccountInput(e.target.value)}
                  placeholder="Paste JSON key from Google Cloud (not shown after save). Leave empty to keep current."
                  rows={4}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
                <p className="text-slate-500 text-xs mt-1">
                  Optional: paste here and click Save. Otherwise set <code className="bg-slate-700 px-1 rounded">GOOGLE_SERVICE_ACCOUNT_JSON</code> in API env.
                </p>
                {backupConfig.hasServiceAccount && (
                  <button
                    type="button"
                    onClick={clearBackupCredentials}
                    disabled={backupConfigSaving}
                    className="mt-2 px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-slate-300 text-xs rounded transition-colors"
                  >
                    Clear stored credentials
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={saveBackupConfig}
                  disabled={backupConfigSaving || backupConfig.needsMigration}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {backupConfigSaving ? 'Saving…' : 'Save settings'}
                </button>
                <button
                  type="button"
                  onClick={runBackupNow}
                  disabled={backupRunning || backupConfigSaving || backupConfig.needsMigration || !backupFolderIdInput.trim()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                  title={!backupFolderIdInput.trim() ? 'Set and save folder ID first' : 'Run backup now (upcoming events → current week folder)'}
                >
                  {backupRunning ? 'Running…' : 'Run backup now'}
                </button>
              </div>
              {(backupConfig.lastRunAt || backupConfig.lastStatus) && (
                <div className="text-slate-400 text-xs pt-2 border-t border-slate-700">
                  {backupConfig.lastRunAt && <span>Last run: {new Date(backupConfig.lastRunAt).toLocaleString()}</span>}
                  {backupConfig.lastStatus && <span className="ml-2">· {backupConfig.lastStatus}</span>}
                </div>
              )}
            </div>
          )}
        </section>

        <section id="branding" className="scroll-mt-16 bg-slate-800/80 rounded-xl border border-slate-700/80 p-6 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center bg-violet-500/20 text-violet-400">
                <Image className="w-4 h-4" strokeWidth={2} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Header logo</h2>
                <p className="text-slate-400 text-sm">Global branding for all users. Saved in Neon app_settings.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-slate-600 bg-slate-900/60 px-4 py-2">
              <span className="text-slate-400 text-xs uppercase tracking-wide">Preview</span>
              <AppLogo size="md" />
              <AppBrandTitle titleClassName="text-lg font-bold text-white leading-tight" />
            </div>
            <button
              type="button"
              onClick={() => void fetchLogoSettings()}
              disabled={logoSettingsLoading || logoSettingsSaving}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm rounded-md transition-colors"
            >
              {logoSettingsLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {logoSettingsNeedsMigration && (
            <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
              <p className="font-medium">Migration required</p>
              <p className="mt-1 text-amber-200/90">
                Run migration <span className="font-mono">034_create_app_settings.sql</span> on Neon, or create the table from here.
              </p>
              <button
                type="button"
                onClick={() => void handleSyncLogoSettingsTable()}
                disabled={logoSettingsSyncingTable}
                className="mt-3 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm rounded-md transition-colors"
              >
                {logoSettingsSyncingTable ? 'Creating table…' : 'Create app_settings table'}
              </button>
            </div>
          )}
          {logoSettingsError && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-200">
              {logoSettingsError}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {LOGO_VARIANTS.map((variant) => {
              const selected = logoVariantId === variant.id;
              return (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => void handleLogoVariantChange(variant.id)}
                  disabled={logoSettingsSaving || logoSettingsLoading || logoSettingsNeedsMigration}
                  className={`rounded-xl border p-4 text-left transition-colors disabled:opacity-60 ${
                    selected
                      ? 'border-blue-500 bg-blue-950/30 ring-1 ring-blue-500/40'
                      : 'border-slate-700 bg-slate-900/40 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-white">{variant.label}</p>
                      <p className="mt-1 text-sm text-slate-400">{variant.description}</p>
                      {variant.type === 'image' && variant.src ? (
                        <p className="mt-2 font-mono text-xs text-slate-500 break-all">{variant.src}</p>
                      ) : null}
                    </div>
                    <span
                      className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border ${
                        selected ? 'border-blue-400 bg-blue-500' : 'border-slate-500'
                      }`}
                      aria-hidden
                    />
                  </div>
                  <div className="mt-4 flex min-h-[48px] items-center rounded-lg bg-slate-800 px-3 py-2">
                    {variant.type === 'image' && variant.src ? (
                      <img
                        src={variant.src}
                        alt=""
                        className="h-8 w-auto max-w-full object-contain object-left"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
                        R
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Active for everyone: <span className="text-slate-300">{getLogoVariant(logoVariantId).appTitle}</span>
            {' '}({getLogoVariant(logoVariantId).label}).
            {logoSettingsSaving ? ' Saving…' : null}
            {logoSettingsUpdatedAt ? (
              <span className="ml-2">Last updated {new Date(logoSettingsUpdatedAt).toLocaleString()}.</span>
            ) : null}
          </p>
        </section>

        {eventAccessUser && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60">
            <div
              className="w-full max-w-2xl bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-h-[90vh] flex flex-col"
              role="dialog"
              aria-labelledby="event-access-title"
            >
              <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-700 shrink-0">
                <div>
                  <h3 id="event-access-title" className="text-lg font-semibold text-white">
                    Event access
                  </h3>
                  <p className="text-slate-400 text-sm mt-1">
                    {eventAccessUser.full_name || eventAccessUser.email}
                    {eventAccessUser.is_admin && (
                      <span className="text-slate-500"> — admins always see all events</span>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeEventAccessModal}
                  className="p-1 text-slate-400 hover:text-white"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
                {eventAccessError && (
                  <div className="px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-200 text-sm">
                    {eventAccessError}
                  </div>
                )}
                <p className="text-slate-400 text-sm">
                  Leave nothing checked for access to <span className="text-white">all events</span>. Check specific
                  events to restrict this user to only those.
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="search"
                    value={eventAccessSearch}
                    onChange={(e) => setEventAccessSearch(e.target.value)}
                    placeholder="Search events…"
                    className="flex-1 min-w-[12rem] px-3 py-2 bg-slate-900/60 border border-slate-600 rounded-lg text-sm text-white placeholder:text-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => setEventAccessSelected(new Set(eventAccessEvents.map((e) => e.id)))}
                    disabled={eventAccessLoading || eventAccessEvents.length === 0}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs rounded-lg"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setEventAccessSelected(new Set())}
                    disabled={eventAccessLoading}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs rounded-lg"
                  >
                    Clear (all events)
                  </button>
                </div>
                {eventAccessLoading ? (
                  <p className="text-slate-400 text-sm">Loading events…</p>
                ) : filteredEventAccessEvents.length === 0 ? (
                  <p className="text-slate-400 text-sm">No events match your search.</p>
                ) : (
                  <ul className="divide-y divide-slate-700/60 border border-slate-700/80 rounded-lg max-h-80 overflow-y-auto">
                    {filteredEventAccessEvents.map((event) => {
                      const checked = eventAccessSelected.has(event.id);
                      return (
                        <li key={event.id}>
                          <label className="flex items-start gap-3 px-3 py-2.5 hover:bg-slate-900/40 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleEventAccessSelection(event.id)}
                              className="mt-1 rounded border-slate-500 bg-slate-900 text-violet-500 focus:ring-violet-500"
                            />
                            <span className="min-w-0">
                              <span className="block text-white text-sm font-medium truncate">{event.name}</span>
                              <span className="block text-slate-500 text-xs">
                                {event.date || 'No date'} · <code className="text-slate-400">{event.id}</code>
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="text-xs text-slate-500">
                  {eventAccessSelected.size === 0
                    ? 'No restrictions — user can access every event.'
                    : `${eventAccessSelected.size} event${eventAccessSelected.size === 1 ? '' : 's'} selected.`}
                </p>
              </div>
              <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-700 shrink-0">
                <button
                  type="button"
                  onClick={closeEventAccessModal}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveEventAccess()}
                  disabled={eventAccessSaving || eventAccessLoading}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
                >
                  {eventAccessSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {accessEmailDraft && approvalEmailDraftContent && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60">
            <div
              className="w-full max-w-lg bg-slate-800 border border-slate-600 rounded-xl shadow-2xl"
              role="dialog"
              aria-labelledby="access-email-draft-title"
            >
              <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-700">
                <div>
                  <h3 id="access-email-draft-title" className="text-lg font-semibold text-white">
                    Email user their access link
                  </h3>
                  <p className="text-slate-400 text-sm mt-1">
                    Opens a draft in Outlook or your default mail app. Send it to{' '}
                    <span className="text-white">{accessEmailDraft.email}</span>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAccessEmailDraft(null)}
                  className="p-1 text-slate-400 hover:text-white"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-5 py-4 space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Subject</p>
                  <p className="text-sm text-white">{approvalEmailDraftContent.subject}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Message</p>
                  <pre className="text-xs text-slate-300 whitespace-pre-wrap bg-slate-900/60 border border-slate-700 rounded-lg p-3 max-h-48 overflow-y-auto">
                    {approvalEmailDraftContent.body}
                  </pre>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <a
                    href={approvalMailtoUrl}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    <Mail className="w-4 h-4" />
                    Open in email app
                  </a>
                  <button
                    type="button"
                    onClick={() => void copyApprovalEmailDraft()}
                    className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {accessEmailCopied ? 'Copied!' : 'Copy message'}
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  Tip: If the link is missing in Outlook, use Copy message and paste into the body manually.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
