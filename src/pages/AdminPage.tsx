import React, { useState, useEffect, useCallback } from 'react';
import { Database, Server, Zap, Users, Timer, Square, FolderOpen, Mail, Copy, Check } from 'lucide-react';
import { getApiBaseUrl } from '../services/api-client';
import { GOOGLE_APPS_SCRIPT_BACKUP_SOURCE } from '../lib/google-apps-script-backup';

const ADMIN_PASSWORD = '1615';
const ADMIN_UNLOCK_KEY = 'ros_admin_unlocked';

// All 12 colors for the puzzle (must match server ADMIN_PUZZLE_COLORS subset). Names are lowercase for API.
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
  };
}

const SERVICE_CONFIG = [
  { key: 'neon' as const, icon: Database, label: 'Neon', desc: 'Database', statusKey: 'connected' as const, iconColor: 'teal' as const },
  { key: 'railway' as const, icon: Server, label: 'Railway', desc: 'API', statusKey: 'connected' as const, iconColor: 'violet' as const },
  { key: 'upstash' as const, icon: Zap, label: 'Upstash', desc: 'Redis / KV', statusKey: 'configured' as const, iconColor: 'amber' as const },
];

function iconColorClasses(ok: boolean, color: 'teal' | 'violet' | 'amber'): string {
  if (!ok) return 'bg-slate-700/80 text-slate-400';
  return color === 'teal' ? 'bg-teal-500/20 text-teal-400' : color === 'violet' ? 'bg-violet-500/20 text-violet-400' : 'bg-amber-500/20 text-amber-400';
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
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState('');
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
  const [scriptCopied, setScriptCopied] = useState(false);

  useEffect(() => {
    setUnlocked(sessionStorage.getItem(ADMIN_UNLOCK_KEY) === '1');
  }, []);

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/health`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setHealth({
          status: 'unhealthy',
          error: data.error || `HTTP ${res.status}`,
          timestamp: (data as any).timestamp,
          services: data.services ?? {
            neon: { connected: false, label: 'Neon' },
            railway: { connected: true, label: 'Railway' },
            upstash: { configured: !!(data as any).upstashConfigured, label: 'Upstash' },
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
      setHealth(data);
    } catch (e) {
      setHealth({
        status: 'unhealthy',
        error: e instanceof Error ? e.message : 'Request failed',
        services: {
          neon: { connected: false, label: 'Neon' },
          railway: { connected: false, label: 'Railway' },
          upstash: { configured: false, label: 'Upstash' },
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
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/admin/presence?key=${ADMIN_PASSWORD}`);
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
    fetchPresence();
    const interval = setInterval(fetchPresence, 15_000);
    return () => clearInterval(interval);
  }, [unlocked, fetchPresence]);

  const fetchBackupConfig = useCallback(async () => {
    setBackupConfigLoading(true);
    setBackupConfigError(null);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/admin/backup-config?key=${ADMIN_PASSWORD}`);
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

  const saveBackupConfig = useCallback(async () => {
    setBackupConfigSaving(true);
    setBackupConfigError(null);
    try {
      const base = getApiBaseUrl();
      const body: { enabled: boolean; folderId: string | null; serviceAccountJson?: string | null } = {
        enabled: backupConfig.enabled,
        folderId: backupFolderIdInput.trim() || null,
      };
      if (backupServiceAccountInput.trim() !== '') {
        body.serviceAccountJson = backupServiceAccountInput.trim();
      }
      const res = await fetch(`${base}/api/admin/backup-config?key=${ADMIN_PASSWORD}`, {
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
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/admin/backup-config?key=${ADMIN_PASSWORD}`, {
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
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/admin/backup-config/check-table?key=${ADMIN_PASSWORD}`);
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
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/admin/backup-config/create-table?key=${ADMIN_PASSWORD}`, { method: 'POST' });
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
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/admin/backup-config/sync-table?key=${ADMIN_PASSWORD}`, { method: 'POST' });
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
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/admin/backup-config/run-now?key=${ADMIN_PASSWORD}`, { method: 'POST' });
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
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/admin/approved-domains?key=${ADMIN_PASSWORD}`);
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
      const data = (await res.json().catch(() => ({}))) as { domains?: string[] };
      setApprovedDomains(Array.isArray(data.domains) ? data.domains : []);
    } catch (e) {
      setApprovedDomainsError(e instanceof Error ? e.message : 'Request failed');
      setApprovedDomains([]);
    } finally {
      setApprovedDomainsLoading(false);
    }
  }, []);

  const addApprovedDomain = useCallback(async () => {
    const domain = addDomainInput.trim().toLowerCase();
    if (!domain) return;
    setAddDomainLoading(true);
    setApprovedDomainsError(null);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/admin/approved-domains?key=${ADMIN_PASSWORD}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
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
        setAddDomainInput('');
      }
    } catch (e) {
      setApprovedDomainsError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setAddDomainLoading(false);
    }
  }, [addDomainInput, fetchApprovedDomains]);

  const removeApprovedDomain = useCallback(async (domain: string) => {
    if (!confirm(`Remove domain "${domain}" from the approved list?`)) return;
    setApprovedDomainsError(null);
    try {
      const base = getApiBaseUrl();
      const encoded = encodeURIComponent(domain);
      const res = await fetch(`${base}/api/admin/approved-domains/${encoded}?key=${ADMIN_PASSWORD}`, {
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
  }, [unlocked, fetchApprovedDomains]);

  const disconnectUser = useCallback(async (eventId: string, userId: string) => {
    if (!confirm('Disconnect this user from the event? They will see a message and must return to the events list.')) return;
    setDisconnectingUserId(userId);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/admin/disconnect-user?key=${ADMIN_PASSWORD}`, {
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
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/admin/running-timers?key=${ADMIN_PASSWORD}`);
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
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/admin/stop-timer?key=${ADMIN_PASSWORD}`, {
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
    if (password !== ADMIN_PASSWORD) {
      setError('Invalid password');
      return;
    }
    let count = 3;
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/admin/puzzle-config?key=${encodeURIComponent(ADMIN_PASSWORD)}`);
      const data = await res.json().catch(() => ({}));
      if (data.count) count = Math.max(1, Math.min(12, Number(data.count)));
    } catch {
      // Use default count
    }
    setPuzzleCount(count);
    setPuzzleShuffled(shuffleArray(PUZZLE_ALL_COLORS));
    setPuzzleSelected([]);
    setPuzzleError(null);
    setShowPuzzle(true);
    setPassword('');
  };

  const handlePuzzleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPuzzleError(null);
    if (puzzleSelected.length !== puzzleCount) return;
    setPuzzleVerifying(true);
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/admin/puzzle-verify?key=${encodeURIComponent(ADMIN_PASSWORD)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colors: puzzleSelected }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        sessionStorage.setItem(ADMIN_UNLOCK_KEY, '1');
        setUnlocked(true);
        setShowPuzzle(false);
        setPuzzleSelected([]);
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
    sessionStorage.removeItem(ADMIN_UNLOCK_KEY);
    setUnlocked(false);
    setPassword('');
    setShowPuzzle(false);
    setPuzzleSelected([]);
    setError(null);
    setPuzzleError(null);
  };

  if (!unlocked && !showPuzzle) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-md border border-slate-700">
          <h2 className="text-xl font-bold text-white text-center mb-6">
            Admin
          </h2>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                placeholder="Enter password"
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
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
            >
              Continue
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!unlocked && showPuzzle) {
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
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Admin</h1>
        <button
          type="button"
          onClick={handleLock}
          className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded-md transition-colors"
        >
          Lock
        </button>
      </header>
      <main className="p-6 max-w-4xl mx-auto space-y-6">
        <section className="bg-slate-800/80 rounded-xl border border-slate-700/80 p-6 backdrop-blur-sm">
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
                {SERVICE_CONFIG.map(({ key, icon: Icon, label, desc, statusKey, iconColor }) => {
                  const svc = health.services[key];
                  const ok = svc ? (statusKey === 'connected' ? svc.connected : svc.configured) : false;
                  const apiBase = key === 'railway' ? getApiBaseUrl() : '';
                  const statusLabel = statusKey === 'connected'
                    ? (ok ? 'Connected' : 'Disconnected')
                    : (ok ? 'Configured' : 'Not configured');
                  return (
                    <li key={key} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${iconColorClasses(ok, iconColor)}`}>
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
                        </div>
                      </div>
                      <span className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${ok ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/80 text-slate-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
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

        <section className="bg-slate-800/80 rounded-xl border border-slate-700/80 p-6 backdrop-blur-sm">
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

        <section className="bg-slate-800/80 rounded-xl border border-slate-700/80 p-6 backdrop-blur-sm">
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

        <section className="bg-slate-800/80 rounded-xl border border-slate-700/80 p-6 backdrop-blur-sm">
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
            Only users with these email domains can sign in. Empty = allow all.
          </p>
          {approvedDomainsError && (
            <div className="mb-4 px-4 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-200 text-sm">
              {approvedDomainsError}
            </div>
          )}
          <div className="flex flex-wrap gap-2 mb-4">
            <input
              type="text"
              value={addDomainInput}
              onChange={(e) => setAddDomainInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addApprovedDomain())}
              placeholder="e.g. company.com"
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 font-mono text-sm w-48"
            />
            <button
              type="button"
              onClick={addApprovedDomain}
              disabled={addDomainLoading || !addDomainInput.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {addDomainLoading ? 'Adding…' : 'Add domain'}
            </button>
          </div>
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

        <section className="bg-slate-800/80 rounded-xl border border-slate-700/80 p-6 backdrop-blur-sm">
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
      </main>
    </div>
  );
}
