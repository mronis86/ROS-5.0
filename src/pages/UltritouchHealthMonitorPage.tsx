import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppLogo from '../components/AppLogo';
import AppBrandTitle from '../components/AppBrandTitle';
import {
  buildHealthLogUpdates,
  deriveOverallState,
  fetchHealthMonitorSnapshot,
  fetchMonitorFeed,
  filterLogEntries,
  formatUptime,
  healthScorePercent,
  loginForMonitorOps,
  modeLabel,
  parseHealthMonitorMode,
  parsePollIntervalMs,
  prependLogEntries,
  railwayUptimeSeconds,
  shortApiHost,
  tilesFromSnapshot,
} from '../lib/ultritouchHealthMonitor';
import type {
  HealthLogEntry,
  HealthLogFilter,
  HealthMonitorSnapshot,
  HealthMonitorTile,
  MonitorFeedSnapshot,
  MonitorPanelTab,
  OverallHealthState,
} from '../types/ultritouchHealthMonitor';
import { ULTRITOUCH_4_PANEL_HEIGHT, ULTRITOUCH_4_PANEL_WIDTH } from '../types/ultritouchHealthMonitor';
import UltritouchOpsLogin from '../components/UltritouchOpsLogin';

const OPS_TOKEN_KEY = 'ros_ultritouch_ops_token';
const OPS_EMAIL_KEY = 'ros_ultritouch_ops_email';

const TILE_GLYPHS: Record<string, string> = {
  neon: 'DB',
  railway: 'API',
  upstash: 'KV',
  api: 'ROS',
  internet: 'WAN',
  localLan: 'LAN',
  netlify: 'CDN',
  resend: 'MAIL',
};

const ACCENT_STYLES: Record<
  HealthMonitorTile['accent'],
  { rail: string; soft: string; text: string }
> = {
  teal: { rail: 'bg-teal-400', soft: 'bg-teal-400/15', text: 'text-teal-300' },
  violet: { rail: 'bg-violet-400', soft: 'bg-violet-400/15', text: 'text-violet-300' },
  amber: { rail: 'bg-amber-400', soft: 'bg-amber-400/15', text: 'text-amber-300' },
  sky: { rail: 'bg-sky-400', soft: 'bg-sky-400/15', text: 'text-sky-300' },
  rose: { rail: 'bg-rose-400', soft: 'bg-rose-400/15', text: 'text-rose-300' },
  emerald: { rail: 'bg-emerald-400', soft: 'bg-emerald-400/15', text: 'text-emerald-300' },
};

const MONITOR_MOTION_CSS = `
@keyframes ut-card-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes ut-status-hit {
  0% { transform: scale(1); }
  35% { transform: scale(1.04); }
  100% { transform: scale(1); }
}
@keyframes ut-status-flash-ok {
  0% { background-color: rgba(16, 185, 129, 0.35); }
  100% { background-color: transparent; }
}
@keyframes ut-status-flash-fail {
  0% { background-color: rgba(244, 63, 94, 0.4); }
  100% { background-color: transparent; }
}
@keyframes ut-activity {
  0%, 100% { transform: scaleY(0.35); opacity: 0.55; }
  50% { transform: scaleY(1); opacity: 1; }
}
@keyframes ut-activity-fail {
  0%, 100% { transform: scaleY(0.2); opacity: 0.4; }
  50% { transform: scaleY(0.55); opacity: 0.85; }
}
@keyframes ut-activity-alert {
  0%, 100% { transform: scaleY(0.3); opacity: 0.5; }
  50% { transform: scaleY(0.8); opacity: 1; }
}
@keyframes ut-status-flash-alert {
  0% { background-color: rgba(245, 158, 11, 0.4); }
  100% { background-color: transparent; }
}
@keyframes ut-activity-idle {
  0%, 100% { transform: scaleY(0.25); opacity: 0.3; }
}
.ut-card-enter {
  animation: ut-card-in 0.3s ease-out both;
}
.ut-status-hit {
  animation: ut-status-hit 0.45s ease-out;
}
.ut-flash-ok {
  animation: ut-status-flash-ok 0.7s ease-out;
}
.ut-flash-fail {
  animation: ut-status-flash-fail 0.7s ease-out;
}
.ut-flash-alert {
  animation: ut-status-flash-alert 0.7s ease-out;
}
.ut-activity-bar {
  transform-origin: bottom center;
  animation: ut-activity 1.35s ease-in-out infinite;
}
.ut-activity-bar-fail {
  transform-origin: bottom center;
  animation: ut-activity-fail 0.85s ease-in-out infinite;
}
.ut-activity-bar-alert {
  transform-origin: bottom center;
  animation: ut-activity-alert 1.1s ease-in-out infinite;
}
.ut-activity-bar-idle {
  transform-origin: bottom center;
  animation: ut-activity-idle 2s ease-in-out infinite;
}
`;

const OVERALL_META: Record<
  OverallHealthState,
  { label: string; pill: string; dot: string; score: string; rail: string }
> = {
  healthy: {
    label: 'Healthy',
    pill: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/35',
    dot: 'bg-emerald-400',
    score: 'text-emerald-300',
    rail: 'bg-emerald-400',
  },
  degraded: {
    label: 'Degraded',
    pill: 'bg-amber-500/15 text-amber-100 border-amber-400/35',
    dot: 'bg-amber-400',
    score: 'text-amber-300',
    rail: 'bg-amber-400',
  },
  down: {
    label: 'Down',
    pill: 'bg-rose-500/15 text-rose-100 border-rose-400/35',
    dot: 'bg-rose-400',
    score: 'text-rose-300',
    rail: 'bg-rose-400',
  },
  loading: {
    label: 'Checking',
    pill: 'bg-slate-500/15 text-slate-200 border-slate-400/30',
    dot: 'bg-slate-400',
    score: 'text-slate-400',
    rail: 'bg-slate-500',
  },
};

const LOG_LEVEL_STYLES: Record<HealthLogEntry['level'], string> = {
  info: 'border-slate-700/60 text-slate-400',
  ok: 'border-emerald-900/50 text-emerald-300',
  warn: 'border-amber-900/50 text-amber-200',
  error: 'border-rose-900/50 text-rose-300',
};

/** Log-tab ops feed live window (independent of health sync). */
const OPS_BURST_MS = 60_000;

function formatLogTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '—';
  }
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-semibold touch-manipulation transition-colors ${
        active
          ? 'bg-sky-500/25 text-sky-100 border border-sky-400/50'
          : 'bg-slate-800/60 text-slate-400 border border-slate-700 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

function ActivityMonitor({
  mode,
  colorClass,
  paused = false,
}: {
  mode: 'ok' | 'alert' | 'fail' | 'skip';
  colorClass: string;
  paused?: boolean;
}) {
  const heights = paused ? [28, 28, 28, 28, 28, 28, 28] : [38, 62, 48, 78, 55, 70, 44];
  const anim = paused
    ? ''
    : mode === 'ok'
      ? 'ut-activity-bar'
      : mode === 'alert'
        ? 'ut-activity-bar-alert'
        : mode === 'fail'
          ? 'ut-activity-bar-fail'
          : 'ut-activity-bar-idle';

  return (
    <div className="flex items-end gap-[3px] h-8 w-full" aria-hidden>
      {heights.map((h, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm ${paused ? 'bg-slate-600' : colorClass} ${anim}`}
          style={{
            height: `${h}%`,
            animationDelay: paused ? undefined : `${i * 0.12}s`,
            animationPlayState: paused ? 'paused' : undefined,
            minWidth: 4,
            opacity: paused ? 0.45 : undefined,
          }}
        />
      ))}
    </div>
  );
}

function ScorePanel({
  percent,
  state,
  uptime,
  pollProgress,
  pollMs,
  syncEnabled,
}: {
  percent: number;
  state: OverallHealthState;
  uptime?: number;
  pollProgress: number;
  pollMs: number;
  syncEnabled: boolean;
}) {
  const meta = syncEnabled
    ? OVERALL_META[state]
    : {
        label: 'Paused',
        pill: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
        dot: 'bg-slate-400',
        score: 'text-slate-400',
        rail: 'bg-slate-500',
      };
  const secondsLeft = Math.max(0, Math.ceil(((1 - pollProgress) * pollMs) / 1000));

  return (
    <aside
      className="ut-card-enter flex flex-col rounded-2xl border border-slate-700/60 bg-slate-900/70 overflow-hidden"
      style={{ animationDelay: '180ms' }}
    >
      <div className={`h-1.5 w-full ${meta.rail}`} />

      {/* Next poll — primary live indicator */}
      <div className="px-3 pt-3 pb-2 border-b border-slate-800/80">
        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold">
          {syncEnabled ? 'Next poll' : 'Sync'}
        </div>
        {syncEnabled ? (
          <div className="flex items-end gap-1 mt-1">
            <span className="text-5xl font-black tabular-nums text-sky-300 leading-none tracking-tighter">
              {secondsLeft}
            </span>
            <span className="text-lg font-bold text-sky-400/80 pb-1">s</span>
          </div>
        ) : (
          <div className="mt-1 text-3xl font-black uppercase tracking-tight text-slate-300 leading-none">
            Paused
          </div>
        )}
        <div className="mt-2.5 h-2.5 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width] duration-200 ease-linear ${
              syncEnabled ? 'bg-sky-400' : 'bg-slate-500'
            }`}
            style={{ width: syncEnabled ? `${Math.max(3, pollProgress * 100)}%` : '100%' }}
          />
        </div>
        {!syncEnabled ? (
          <div className="mt-1.5 text-[10px] text-slate-500">No auto-poll · no egress</div>
        ) : null}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-3 py-3 gap-1.5">
        <div className={`text-5xl font-black tabular-nums leading-none tracking-tighter ${meta.score}`}>
          {syncEnabled ? percent : '—'}
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold">
          {syncEnabled ? 'score' : 'frozen'}
        </div>
        <div className={`mt-1 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase ${meta.pill}`}>
          <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
          {meta.label}
        </div>
      </div>

      <div className="px-3 pb-3 pt-2 border-t border-slate-800/80">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500 uppercase tracking-wide">Uptime</span>
          <span className="text-white font-bold tabular-nums">{formatUptime(uptime)}</span>
        </div>
      </div>
    </aside>
  );
}

function ServiceCard({
  tile,
  selected,
  onSelect,
  index,
  paused = false,
}: {
  tile: HealthMonitorTile;
  selected: boolean;
  onSelect: () => void;
  index: number;
  paused?: boolean;
}) {
  const glyph = TILE_GLYPHS[tile.id] ?? '•';
  const styles = ACCENT_STYLES[tile.accent];
  const level = tile.level ?? (tile.skipped ? 'alert' : tile.ok ? 'ok' : 'fail');
  const statusLabel = paused
    ? 'HOLD'
    : level === 'ok'
      ? 'OK'
      : level === 'alert'
        ? 'ALERT'
        : 'FAIL';
  const prevLevelRef = useRef<string | null>(null);
  const [flashClass, setFlashClass] = useState('');
  const activityMode = level === 'ok' ? 'ok' : level === 'alert' ? 'alert' : 'fail';
  const activityColor =
    level === 'ok' ? styles.rail : level === 'alert' ? 'bg-amber-400' : 'bg-rose-500';

  useEffect(() => {
    if (paused) return;
    const prev = prevLevelRef.current;
    prevLevelRef.current = level;
    if (prev === null) return;
    if (prev === level) return;
    const flash =
      level === 'ok' ? 'ut-flash-ok' : level === 'alert' ? 'ut-flash-alert' : 'ut-flash-fail';
    setFlashClass(`${flash} ut-status-hit`);
    const id = window.setTimeout(() => setFlashClass(''), 700);
    return () => window.clearTimeout(id);
  }, [level, paused]);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`ut-card-enter relative flex rounded-2xl border overflow-hidden h-full w-full text-left touch-manipulation transition-colors duration-150 active:scale-[0.99] ${
        paused ? '' : flashClass
      } ${
        selected
          ? 'border-sky-400/70 ring-2 ring-sky-400/25'
          : paused
            ? 'border-slate-700/70 bg-slate-950/80 opacity-80'
            : level === 'ok'
              ? 'border-slate-600/55 bg-slate-900/85'
              : level === 'alert'
                ? 'border-amber-500/45 bg-amber-950/20'
                : 'border-rose-500/40 bg-rose-950/25'
      }`}
      style={{ animationDelay: `${index * 55}ms` }}
    >
      <div
        className={`w-1.5 shrink-0 self-stretch ${
          paused
            ? 'bg-slate-600'
            : level === 'ok'
              ? styles.rail
              : level === 'alert'
                ? 'bg-amber-400'
                : 'bg-rose-500'
        }`}
      />
      <div className="flex flex-col flex-1 min-w-0 px-3 py-3 gap-1.5">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div
              className={`text-[10px] font-black tracking-[0.14em] uppercase ${
                paused || level === 'fail' ? 'text-slate-500' : styles.text
              }`}
            >
              {glyph}
            </div>
            <div className="text-[1.05rem] font-black text-white leading-tight tracking-tight mt-0.5 break-words">
              {tile.label}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 font-medium leading-snug">
              {tile.subtitle}
            </div>
          </div>
          <div
            className={`shrink-0 text-lg font-black leading-none tracking-tight pt-0.5 ${
              paused
                ? 'text-slate-500'
                : level === 'ok'
                  ? 'text-emerald-300'
                  : level === 'alert'
                    ? 'text-amber-300'
                    : 'text-rose-300'
            }`}
          >
            {statusLabel}
          </div>
        </div>

        <div
          className={`text-[12px] font-mono leading-snug line-clamp-2 ${
            paused
              ? 'text-slate-500'
              : level === 'ok'
                ? 'text-slate-100'
                : level === 'alert'
                  ? 'text-amber-100'
                  : 'text-rose-100'
          }`}
          title={tile.detail}
        >
          {paused ? 'Sync paused — last snapshot' : tile.detail || '—'}
        </div>

        <div className="mt-auto pt-1">
          <div className="text-[8px] uppercase tracking-[0.14em] text-slate-500 mb-1 font-semibold">
            {paused ? 'Idle' : 'Activity'}
          </div>
          <ActivityMonitor mode={activityMode} colorClass={activityColor} paused={paused} />
        </div>
      </div>
    </button>
  );
}

const UltritouchHealthMonitorPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const mode = parseHealthMonitorMode(searchParams.get('mode'));
  const pollMs = parsePollIntervalMs(searchParams.get('interval'));

  const [activeTab, setActiveTab] = useState<MonitorPanelTab>('dashboard');
  const [snapshot, setSnapshot] = useState<HealthMonitorSnapshot | null>(null);
  const [monitorFeed, setMonitorFeed] = useState<MonitorFeedSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetchAt, setLastFetchAt] = useState<Date | null>(null);
  const [logEntries, setLogEntries] = useState<HealthLogEntry[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<HealthLogFilter>('all');
  const [pollProgress, setPollProgress] = useState(0);
  /** When false, health auto-poll stops (dashboard only — separate from ops log burst). */
  const [syncEnabled, setSyncEnabled] = useState(true);
  /** Log-tab ops feed: timeboxed live poll (does not use health Pause/Resume). */
  const [opsLive, setOpsLive] = useState(false);
  const [opsBurstEndsAt, setOpsBurstEndsAt] = useState<number | null>(null);
  const [opsSecondsLeft, setOpsSecondsLeft] = useState(0);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);
  const [lastOpsFetchAt, setLastOpsFetchAt] = useState<Date | null>(null);
  const [opsToken, setOpsToken] = useState<string | null>(() => sessionStorage.getItem(OPS_TOKEN_KEY));
  const [opsEmail, setOpsEmail] = useState<string | null>(() => sessionStorage.getItem(OPS_EMAIL_KEY));
  const [showOpsLogin, setShowOpsLogin] = useState(false);
  const [opsLoginBusy, setOpsLoginBusy] = useState(false);
  const [opsLoginError, setOpsLoginError] = useState<string | null>(null);

  const prevTilesRef = useRef<HealthMonitorTile[] | null>(null);
  const prevOverallRef = useRef<OverallHealthState | null>(null);
  const firstLoadRef = useRef(true);
  const lastFetchMsRef = useRef<number>(Date.now());
  const opsBurstEndingRef = useRef(false);

  const tiles = useMemo(() => (snapshot ? tilesFromSnapshot(snapshot) : []), [snapshot]);
  const overall = deriveOverallState(snapshot, error, loading);
  const score = healthScorePercent(overall, tiles);
  const uptime = railwayUptimeSeconds(snapshot);
  const host = shortApiHost(mode);
  const refreshBtnClass = !syncEnabled
    ? 'border-slate-500/40 bg-slate-500/15 text-slate-200 hover:bg-slate-500/25'
    : overall === 'down'
      ? 'border-rose-500/50 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30'
      : overall === 'degraded'
        ? 'border-amber-500/50 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30'
        : overall === 'loading'
          ? 'border-slate-500/40 bg-slate-500/15 text-slate-200 hover:bg-slate-500/25'
          : 'border-emerald-500/45 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25';
  const visibleLogs = useMemo(
    () => filterLogEntries(logEntries, logFilter, selectedServiceId),
    [logEntries, logFilter, selectedServiceId]
  );

  const applyPollResult = useCallback(
    (
      data: HealthMonitorSnapshot | null,
      pollError: string | null,
      manual: boolean,
      prevSnapshot: HealthMonitorSnapshot | null
    ) => {
      const nextTiles = data ? tilesFromSnapshot(data) : prevTilesRef.current ?? [];
      const nextOverall = deriveOverallState(data ?? prevSnapshot, pollError, false);
      const updates = buildHealthLogUpdates(
        prevTilesRef.current,
        nextTiles,
        prevOverallRef.current,
        nextOverall,
        pollError,
        { manual, firstLoad: firstLoadRef.current }
      );
      if (updates.length > 0) {
        setLogEntries((prev) => prependLogEntries(prev, updates));
      }
      prevTilesRef.current = nextTiles;
      prevOverallRef.current = nextOverall;
      firstLoadRef.current = false;
    },
    []
  );

  const refreshHealth = useCallback(
    async (manual = false) => {
      if (manual) setLoading(true);
      try {
        const data = await fetchHealthMonitorSnapshot(mode);
        setSnapshot((prev) => {
          applyPollResult(data, null, manual, prev);
          return data;
        });
        setError(null);
        setLastFetchAt(new Date());
        lastFetchMsRef.current = Date.now();
        setPollProgress(0);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Health check failed';
        setSnapshot((prev) => {
          applyPollResult(null, msg, manual, prev);
          return prev;
        });
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [mode, applyPollResult]
  );

  const refreshOps = useCallback(
    async (manual = false) => {
      const token = opsToken || sessionStorage.getItem(OPS_TOKEN_KEY);
      if (!token) {
        setOpsError('Sign in required for ops log');
        return;
      }
      if (manual) setOpsLoading(true);
      try {
        const feed = await fetchMonitorFeed(mode, token);
        setMonitorFeed(feed);
        setOpsError(null);
        setLastOpsFetchAt(new Date());
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Ops feed failed';
        setOpsError(msg);
        if (msg.includes('401') || /unauthor/i.test(msg)) {
          sessionStorage.removeItem(OPS_TOKEN_KEY);
          sessionStorage.removeItem(OPS_EMAIL_KEY);
          setOpsToken(null);
          setOpsEmail(null);
          setOpsLive(false);
          setOpsBurstEndsAt(null);
        }
      } finally {
        setOpsLoading(false);
      }
    },
    [mode, opsToken]
  );

  const appendMonitorLog = useCallback((message: string, detail?: string) => {
    setLogEntries((prev) =>
      prependLogEntries(prev, [
        {
          id: `ops-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          at: new Date().toISOString(),
          level: 'info',
          message,
          detail,
        },
      ])
    );
  }, []);

  useEffect(() => {
    firstLoadRef.current = true;
    prevTilesRef.current = null;
    prevOverallRef.current = null;
    setLogEntries([]);
    setLoading(true);
    lastFetchMsRef.current = Date.now();
    void refreshHealth(false);
    // Ops feed is auth-gated — only pull if this panel session already signed in.
    if (sessionStorage.getItem(OPS_TOKEN_KEY)) {
      void refreshOps(false);
    }
  }, [mode, pollMs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!syncEnabled) return;
    const id = window.setInterval(() => void refreshHealth(false), pollMs);
    return () => window.clearInterval(id);
  }, [mode, pollMs, syncEnabled, refreshHealth]);

  useEffect(() => {
    if (!syncEnabled) return;
    const id = window.setInterval(() => {
      const elapsed = Date.now() - lastFetchMsRef.current;
      setPollProgress(Math.min(1, elapsed / pollMs));
    }, 200);
    return () => window.clearInterval(id);
  }, [pollMs, syncEnabled]);

  // Log-tab ops feed: live for a fixed window, then auto-stop (independent of health sync).
  useEffect(() => {
    if (!opsLive || !opsBurstEndsAt || !opsToken) return;
    opsBurstEndingRef.current = false;
    void refreshOps(false);
    const pollId = window.setInterval(() => void refreshOps(false), pollMs);
    const tickId = window.setInterval(() => {
      const leftMs = opsBurstEndsAt - Date.now();
      const left = Math.max(0, Math.ceil(leftMs / 1000));
      setOpsSecondsLeft(left);
      if (leftMs <= 0 && !opsBurstEndingRef.current) {
        opsBurstEndingRef.current = true;
        setOpsLive(false);
        setOpsBurstEndsAt(null);
        setOpsSecondsLeft(0);
        appendMonitorLog('Ops live ended', '1‑minute burst finished — ops polling stopped');
      }
    }, 250);
    return () => {
      window.clearInterval(pollId);
      window.clearInterval(tickId);
    };
  }, [opsLive, opsBurstEndsAt, pollMs, refreshOps, appendMonitorLog]);

  const toggleSync = () => {
    if (syncEnabled) {
      setSyncEnabled(false);
      setPollProgress(0);
      setLogEntries((prev) =>
        prependLogEntries(prev, [
          {
            id: `sync-pause-${Date.now()}`,
            at: new Date().toISOString(),
            level: 'info',
            message: 'Health sync paused',
            detail: 'Dashboard auto-poll stopped — ops log burst unchanged',
          },
        ])
      );
      return;
    }
    setSyncEnabled(true);
    lastFetchMsRef.current = Date.now();
    setPollProgress(0);
    setLogEntries((prev) =>
      prependLogEntries(prev, [
        {
          id: `sync-resume-${Date.now()}`,
          at: new Date().toISOString(),
          level: 'info',
          message: 'Health sync resumed',
          detail: 'Dashboard auto-poll active',
        },
      ])
    );
    void refreshHealth(true);
  };

  const startOpsBurst = () => {
    if (!opsToken) {
      setShowOpsLogin(true);
      setOpsLoginError(null);
      return;
    }
    setOpsLive(true);
    setOpsBurstEndsAt(Date.now() + OPS_BURST_MS);
    setOpsSecondsLeft(Math.ceil(OPS_BURST_MS / 1000));
    appendMonitorLog('Ops live started', 'Polling /api/monitor/snapshot for 1 minute');
  };

  const stopOpsBurst = () => {
    setOpsLive(false);
    setOpsBurstEndsAt(null);
    setOpsSecondsLeft(0);
    appendMonitorLog('Ops live stopped', 'Manual stop — ops polling stopped');
  };

  const pullOpsOnce = () => {
    if (!opsToken) {
      setShowOpsLogin(true);
      setOpsLoginError(null);
      return;
    }
    appendMonitorLog('Ops pull once', 'Single /api/monitor/snapshot request');
    void refreshOps(true);
  };

  const handleOpsLogin = async (email: string, password: string) => {
    setOpsLoginBusy(true);
    setOpsLoginError(null);
    try {
      const result = await loginForMonitorOps(email, password);
      sessionStorage.setItem(OPS_TOKEN_KEY, result.token);
      sessionStorage.setItem(OPS_EMAIL_KEY, result.email);
      setOpsToken(result.token);
      setOpsEmail(result.email);
      setShowOpsLogin(false);
      appendMonitorLog('Ops signed in', result.email);
      await refreshOps(true);
    } catch (e) {
      setOpsLoginError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setOpsLoginBusy(false);
    }
  };

  const signOutOps = () => {
    setOpsLive(false);
    setOpsBurstEndsAt(null);
    setOpsSecondsLeft(0);
    sessionStorage.removeItem(OPS_TOKEN_KEY);
    sessionStorage.removeItem(OPS_EMAIL_KEY);
    setOpsToken(null);
    setOpsEmail(null);
    setMonitorFeed(null);
    setOpsError(null);
    setLastOpsFetchAt(null);
    appendMonitorLog('Ops signed out', 'Cleared ops session for this panel');
  };

  const handleSelectTile = (tileId: string) => {
    setSelectedServiceId((prev) => (prev === tileId ? null : tileId));
  };

  return (
    <div
      className="relative overflow-hidden bg-[#070b14] text-slate-100 select-none"
      style={{
        width: ULTRITOUCH_4_PANEL_WIDTH,
        height: ULTRITOUCH_4_PANEL_HEIGHT,
        minWidth: ULTRITOUCH_4_PANEL_WIDTH,
        minHeight: ULTRITOUCH_4_PANEL_HEIGHT,
      }}
    >
      <style>{MONITOR_MOTION_CSS}</style>
      <div
        className="h-full w-full flex flex-col"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 0% 0%, rgba(56,189,248,0.07), transparent 50%), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(139,92,246,0.08), transparent 45%), linear-gradient(180deg, #0b1220 0%, #070b14 100%)',
        }}
      >
        <header className="flex items-center gap-3 px-4 py-3 shrink-0 border-b border-slate-800/80">
          <div className="shrink-0 flex items-center gap-2.5 min-w-0">
            <AppLogo size="md" className="shrink-0 object-contain object-left max-h-10" />
            <AppBrandTitle
              titleClassName="text-base font-bold text-white leading-none truncate"
              taglineClassName="text-[9px] uppercase tracking-[0.08em] text-slate-500 leading-none mt-0.5"
              showTagline
            />
          </div>
          <div className="min-w-0 flex-1 text-right">
            <div className="text-[10px] text-slate-500 truncate">
              {modeLabel(mode, snapshot)} · {host}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <TabButton active={activeTab === 'dashboard'} label="Dashboard" onClick={() => setActiveTab('dashboard')} />
            <TabButton active={activeTab === 'log'} label="Log" onClick={() => setActiveTab('log')} />
            <button
              type="button"
              onClick={toggleSync}
              aria-pressed={syncEnabled}
              title={
                syncEnabled
                  ? 'Pause Health — stop dashboard auto-polling'
                  : 'Resume Health — start dashboard auto-polling again'
              }
              className={`rounded-lg border px-3.5 py-2 text-sm font-semibold touch-manipulation active:scale-95 transition-colors ${
                syncEnabled
                  ? 'border-amber-500/55 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30'
                  : 'border-yellow-500/60 bg-yellow-500/25 text-yellow-50 hover:bg-yellow-500/35'
              }`}
            >
              {syncEnabled ? 'Pause Health' : 'Resume Health'}
            </button>
            <button
              type="button"
              onClick={() => void refreshHealth(true)}
              disabled={loading}
              className={`rounded-lg border px-3.5 py-2 text-sm font-semibold touch-manipulation disabled:opacity-50 active:scale-95 transition-colors ${refreshBtnClass}`}
            >
              {loading ? '…' : 'Refresh'}
            </button>
          </div>
        </header>

        {activeTab === 'dashboard' ? (
          <main className="flex-1 grid grid-cols-[1fr_168px] gap-3.5 px-4 py-3.5 min-h-0">
            <div
              className={`grid gap-3.5 min-h-0 ${
                tiles.length >= 5 ? 'grid-cols-5' : 'grid-cols-4'
              }`}
            >
              {tiles.length > 0
                ? tiles.map((tile, index) => (
                    <ServiceCard
                      key={tile.id}
                      tile={tile}
                      index={index}
                      paused={!syncEnabled}
                      selected={selectedServiceId === tile.id}
                      onSelect={() => handleSelectTile(tile.id)}
                    />
                  ))
                : Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="ut-card-enter rounded-2xl border border-slate-800 bg-slate-900/40 animate-pulse"
                      style={{ animationDelay: `${i * 55}ms` }}
                    />
                  ))}
            </div>
            <ScorePanel
              percent={score}
              state={overall}
              uptime={uptime}
              pollProgress={pollProgress}
              pollMs={pollMs}
              syncEnabled={syncEnabled}
            />
          </main>
        ) : (
          <main className="flex-1 grid grid-cols-2 gap-3 px-4 py-3 min-h-0">
            <section className="flex flex-col rounded-2xl border border-slate-700/50 bg-slate-900/40 min-h-0 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-800/80 flex items-center justify-between gap-2 shrink-0">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white">Show ops</div>
                  <div className="text-[10px] text-slate-500 truncate">
                    {!opsToken
                      ? 'Sign in required · endpoint stays private'
                      : opsLive
                        ? `Live · ${opsSecondsLeft}s left · ${opsEmail || host}`
                        : lastOpsFetchAt
                          ? `Signed in · last ${lastOpsFetchAt.toLocaleTimeString()}`
                          : `Signed in as ${opsEmail || 'user'} · pull when ready`}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!opsToken ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOpsLoginError(null);
                        setShowOpsLogin(true);
                      }}
                      className="rounded-md border border-emerald-500/45 bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/30 touch-manipulation"
                    >
                      Sign in
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={pullOpsOnce}
                        disabled={opsLoading || opsLive}
                        title="One authenticated request to /api/monitor/snapshot"
                        className="rounded-md border border-slate-600/70 bg-slate-800/70 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700/80 disabled:opacity-40 touch-manipulation"
                      >
                        {opsLoading && !opsLive ? '…' : 'Pull once'}
                      </button>
                      {opsLive ? (
                        <button
                          type="button"
                          onClick={stopOpsBurst}
                          className="rounded-md border border-amber-500/50 bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/30 touch-manipulation tabular-nums"
                        >
                          Stop · {opsSecondsLeft}s
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={startOpsBurst}
                          title="Poll ops API for 1 minute, then auto-stop"
                          className="rounded-md border border-sky-500/45 bg-sky-500/15 px-2.5 py-1 text-[11px] font-semibold text-sky-100 hover:bg-sky-500/25 touch-manipulation"
                        >
                          Live 1 min
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={signOutOps}
                        disabled={opsLive}
                        className="rounded-md border border-slate-600/70 bg-slate-900/80 px-2.5 py-1 text-[11px] font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-40 touch-manipulation"
                      >
                        Sign out
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 text-sm">
                {!opsToken ? (
                  <div className="text-xs text-slate-400 leading-relaxed space-y-2">
                    <p>
                      Ops snapshot stays behind API auth. Use <span className="text-emerald-300 font-semibold">Sign in</span>{' '}
                      with an approved account and the on-screen keyboard.
                    </p>
                    <p className="text-slate-500">Health dashboard does not need this login.</p>
                  </div>
                ) : null}
                {opsToken && opsError ? (
                  <div className="text-xs text-amber-200/90 leading-relaxed border border-amber-500/25 bg-amber-950/20 rounded-lg px-2.5 py-2">
                    {opsError}
                  </div>
                ) : null}
                {opsToken && monitorFeed ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg bg-slate-800/60 px-2 py-2 text-center">
                        <div className="text-[9px] uppercase text-slate-500">Shows live</div>
                        <div className="text-xl font-bold text-white tabular-nums">
                          {monitorFeed.ops.activeEventCount}
                        </div>
                      </div>
                      <div className="rounded-lg bg-slate-800/60 px-2 py-2 text-center">
                        <div className="text-[9px] uppercase text-slate-500">Viewers</div>
                        <div className="text-xl font-bold text-white tabular-nums">
                          {monitorFeed.ops.totalViewers ?? '—'}
                        </div>
                      </div>
                      <div className="rounded-lg bg-slate-800/60 px-2 py-2 text-center">
                        <div className="text-[9px] uppercase text-slate-500">Sockets</div>
                        <div className="text-xl font-bold text-white tabular-nums">
                          {monitorFeed.ops.socketConnections ?? '—'}
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 font-semibold">
                        Running timers
                      </div>
                      {monitorFeed.ops.runningTimers.length === 0 ? (
                        <div className="text-slate-500 text-xs">No active timers</div>
                      ) : (
                        <ul className="space-y-1.5">
                          {monitorFeed.ops.runningTimers.map((t) => (
                            <li
                              key={`${t.eventId}-${t.cueIs}`}
                              className="rounded-lg border border-amber-500/25 bg-amber-950/20 px-2.5 py-2"
                            >
                              <div className="font-semibold text-amber-100 truncate">{t.cueIs}</div>
                              <div className="text-[11px] text-slate-400 truncate">{t.eventName}</div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {monitorFeed.ops.events.length > 0 ? (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 font-semibold">
                          Active events
                        </div>
                        <ul className="space-y-1">
                          {monitorFeed.ops.events.map((e) => (
                            <li
                              key={e.eventId}
                              className="flex items-center justify-between text-xs rounded-lg bg-slate-800/50 px-2.5 py-1.5"
                            >
                              <span className="truncate text-slate-200">{e.eventName}</span>
                              <span className="text-sky-300 font-bold tabular-nums shrink-0 ml-2">
                                {e.viewerCount}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                ) : opsToken ? (
                  <div className="text-xs text-slate-500 leading-relaxed">
                    Signed in. Use <span className="text-slate-300">Pull once</span> or{' '}
                    <span className="text-slate-300">Live 1 min</span> to load{' '}
                    <span className="text-slate-400 font-mono">/api/monitor/snapshot</span>.
                  </div>
                ) : null}
              </div>
            </section>

            <section className="flex flex-col rounded-2xl border border-slate-700/50 bg-slate-900/40 min-h-0 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-800/80 flex items-center justify-between shrink-0">
                <div className="text-xs font-semibold text-white">Health log</div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setLogFilter('all')}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      logFilter === 'all' ? 'bg-sky-500/20 text-sky-200' : 'text-slate-500'
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogFilter('alerts')}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      logFilter === 'alerts' ? 'bg-amber-500/20 text-amber-200' : 'text-slate-500'
                    }`}
                  >
                    Alerts
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogEntries([])}
                    className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase text-slate-500 hover:text-slate-300"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                {visibleLogs.length === 0 ? (
                  <div className="p-3 text-xs text-slate-500">
                    Status changes and errors appear here as polls run.
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-800/60">
                    {visibleLogs.map((entry) => (
                      <li
                        key={entry.id}
                        className={`px-3 py-2 border-l-2 ${LOG_LEVEL_STYLES[entry.level]}`}
                      >
                        <div className="flex gap-2 text-xs">
                          <span className="text-slate-500 font-mono tabular-nums shrink-0">
                            {formatLogTime(entry.at)}
                          </span>
                          <span className="font-medium">{entry.message}</span>
                        </div>
                        {entry.detail ? (
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5 pl-[52px] truncate">
                            {entry.detail}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </main>
        )}

        <footer className="flex items-center justify-between px-4 py-1.5 shrink-0 border-t border-slate-800/80 text-[10px] text-slate-500">
          <span>
            {activeTab === 'dashboard'
              ? 'Tap a service card for details · Pause Health is health-only'
              : opsToken
                ? opsLive
                  ? `Ops live ${opsSecondsLeft}s · signed in as ${opsEmail || 'user'}`
                  : `Ops ready · ${opsEmail || 'signed in'} · Pull once or Live 1 min`
                : 'Ops: Sign in with on-screen keyboard · endpoint stays private'}
          </span>
          <span className="tabular-nums">
            {loading || opsLoading ? (
              <span className="text-sky-400 animate-pulse mr-2">
                {opsLoading && !loading ? 'Ops…' : 'Refreshing'}
              </span>
            ) : null}
            {lastFetchAt ? lastFetchAt.toLocaleTimeString() : '—'}
          </span>
        </footer>
      </div>
      {showOpsLogin ? (
        <UltritouchOpsLogin
          busy={opsLoginBusy}
          error={opsLoginError}
          onCancel={() => {
            if (!opsLoginBusy) {
              setShowOpsLogin(false);
              setOpsLoginError(null);
            }
          }}
          onSubmit={handleOpsLogin}
        />
      ) : null}
    </div>
  );
};

export default UltritouchHealthMonitorPage;
