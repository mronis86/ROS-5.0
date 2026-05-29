import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getApiBaseUrl } from '../services/api-client';
import { socketClient, onCloudModeChange } from '../services/socket-client';
import { fetchConnectivityStatus, type ConnectivitySnapshot } from '../services/connectivity-status';

type QuickTimer = {
  id: number;
  title: string;
  cue: string;
  durationMs: number;
  remainingMs: number;
  isRunning: boolean;
  startedAtMs: number | null;
};

const STORAGE_KEY_PREFIX = 'ros.quickMode.timers.';

const clampDurationMs = (value: number) => Math.max(1000, Math.min(value, 24 * 60 * 60 * 1000));

const formatTime = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const nowRemainingMs = (timer: QuickTimer, nowMs: number) => {
  if (!timer.isRunning || !timer.startedAtMs) return timer.remainingMs;
  return Math.max(0, timer.remainingMs - (nowMs - timer.startedAtMs));
};

const buildQuickEventId = () =>
  `quick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const toScheduleItem = (timer: QuickTimer) => {
  const totalSeconds = Math.max(1, Math.floor(timer.durationMs / 1000));
  return {
    id: timer.id,
    day: 1,
    programType: 'No Transition',
    shotType: '',
    segmentName: timer.title,
    durationHours: Math.floor(totalSeconds / 3600),
    durationMinutes: Math.floor((totalSeconds % 3600) / 60),
    durationSeconds: totalSeconds % 60,
    notes: '',
    assets: '',
    speakersText: '',
    hasPPT: false,
    hasQA: false,
    customFields: { cue: timer.cue }
  };
};

type TimerUiState = 'READY' | 'LOADED' | 'RUNNING' | 'DONE';
const timerState = (timer: QuickTimer, nowMs: number, loadedTimerId: number | null): TimerUiState => {
  if (timer.isRunning) return 'RUNNING';
  if (nowRemainingMs(timer, nowMs) <= 0) return 'DONE';
  if (loadedTimerId === timer.id) return 'LOADED';
  return 'READY';
};

const QuickModePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [eventId, setEventId] = useState('');
  const [timers, setTimers] = useState<QuickTimer[]>([]);
  const [selectedTimerId, setSelectedTimerId] = useState<number | null>(null);
  const [loadedTimerId, setLoadedTimerId] = useState<number | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [minutesDraft, setMinutesDraft] = useState('5');
  const [secondsDraft, setSecondsDraft] = useState('0');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [isCompanionSyncing, setIsCompanionSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [connectivity, setConnectivity] = useState<ConnectivitySnapshot | null>(null);

  useEffect(() => {
    document.title = 'Offline Show · Quick Mode';
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await fetchConnectivityStatus();
        if (!cancelled) setConnectivity(status);
      } catch {
        if (!cancelled) setConnectivity(null);
      }
    };
    void refresh();
    const id = window.setInterval(refresh, 20_000);
    const unsub = onCloudModeChange(() => void refresh());
    return () => {
      cancelled = true;
      window.clearInterval(id);
      unsub();
    };
  }, []);

  const storageKey = useMemo(() => (eventId ? `${STORAGE_KEY_PREFIX}${eventId}` : ''), [eventId]);

  useEffect(() => {
    const fromQuery = (searchParams.get('eventId') || '').trim();
    if (fromQuery) {
      setEventId(fromQuery);
      return;
    }
    const generated = buildQuickEventId();
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('eventId', generated);
      return p;
    }, { replace: true });
    setEventId(generated);
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as QuickTimer[];
      if (!Array.isArray(parsed)) return;
      const hydrated = parsed
        .filter((t) => t && Number.isFinite(Number(t.id)))
        .map((t) => ({
          id: Number(t.id),
          title: typeof t.title === 'string' && t.title.trim() ? t.title : 'Quick Timer',
          cue: typeof t.cue === 'string' && t.cue.trim() ? t.cue : `CUE ${Number(t.id)}`,
          durationMs: clampDurationMs(Number(t.durationMs) || 5 * 60 * 1000),
          remainingMs: Math.max(0, Number(t.remainingMs) || 5 * 60 * 1000),
          isRunning: false,
          startedAtMs: null
        }));
      setTimers(hydrated);
      setSelectedTimerId((prev) => (prev != null && hydrated.some((t) => t.id === prev) ? prev : hydrated[0]?.id ?? null));
    } catch {
      // ignore invalid localStorage data
    }
  }, [storageKey]);

  useEffect(() => {
    setSelectedTimerId((prev) => (prev != null && timers.some((t) => t.id === prev) ? prev : timers[0]?.id ?? null));
  }, [timers]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const snapshot = timers.map((t) => ({
        ...t,
        remainingMs: nowRemainingMs(t, Date.now()),
        isRunning: false,
        startedAtMs: null
      }));
      localStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch {
      // ignore
    }
  }, [timers, storageKey]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    const syncSchedule = async () => {
      try {
        setIsCompanionSyncing(true);
        const payload = {
          event_id: eventId,
          event_name: `Quick Mode ${eventId}`,
          event_date: new Date().toISOString().slice(0, 10),
          schedule_items: timers.map(toScheduleItem),
          custom_columns: [],
          settings: { quickMode: true, source: 'quick-mode' },
          last_modified_by: 'quick-mode',
          last_modified_by_name: 'Quick Mode',
          last_modified_by_role: 'OPERATOR'
        };
        const res = await fetch(`${getApiBaseUrl()}/api/run-of-show-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!cancelled) setSyncMessage('Synced to show server');
      } catch {
        if (!cancelled) setSyncMessage('Show server unavailable');
      } finally {
        if (!cancelled) setIsCompanionSyncing(false);
      }
    };
    const id = window.setTimeout(syncSchedule, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [eventId, timers]);

  const applyServerTimerRow = (data: Record<string, unknown>) => {
    const itemId = Number(data.item_id);
    if (!Number.isFinite(itemId)) return;
    const durationMs = Math.max(1000, Number(data.duration_seconds || 60) * 1000);
    const running = data.is_running === true || data.is_running === 1;
    const loaded =
      data.timer_state === 'loaded' ||
      (data.is_active === true && !running) ||
      (data.is_active === 1 && !running);
    const startedAtMs = running && data.started_at ? new Date(String(data.started_at)).getTime() : null;
    const now = Date.now();
    setTimers((prev) => {
      const exists = prev.some((t) => t.id === itemId);
      const nextRemaining = running
        ? Math.max(0, durationMs - (now - (startedAtMs || now)))
        : loaded
          ? durationMs
          : durationMs;
      if (!exists) {
        return [
          ...prev,
          {
            id: itemId,
            title: String(data.cue_is || `Timer ${itemId}`).replace(/^CUE\s*/i, 'Timer '),
            cue: String(data.cue_is || `CUE ${itemId}`),
            durationMs,
            remainingMs: nextRemaining,
            isRunning: running,
            startedAtMs
          }
        ];
      }
      return prev.map((t) => {
        if (t.id !== itemId) return running ? { ...t, isRunning: false, startedAtMs: null } : t;
        return { ...t, durationMs, remainingMs: nextRemaining, isRunning: running, startedAtMs };
      });
    });
    if (running || loaded) setLoadedTimerId(itemId);
    if (data.timer_state === 'stopped' || data.is_active === false) {
      setLoadedTimerId((prev) => (prev === itemId ? null : prev));
    }
  };

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    const hydrateFromApi = async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/active-timers/${eventId}`);
        if (!res.ok || cancelled) return;
        const rows = await res.json();
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (row && row.is_active !== false && row.timer_state !== 'stopped') {
          applyServerTimerRow(row);
        }
      } catch {
        // local timers still work
      }
    };

    const applyActiveTimerRow = (row: Record<string, unknown> | null | undefined) => {
      if (!row) {
        setLoadedTimerId(null);
        return;
      }
      if (row.timer_state === 'stopped' || row.is_active === false) {
        const itemId = Number(row.item_id);
        setTimers((prev) =>
          prev.map((t) => (t.id === itemId ? { ...t, isRunning: false, startedAtMs: null } : t))
        );
        setLoadedTimerId((prev) => (prev === itemId ? null : prev));
        return;
      }
      applyServerTimerRow(row);
    };

    const callbacks = {
      onTimerUpdated: (data: Record<string, unknown>) => applyServerTimerRow(data),
      onActiveTimersUpdated: (data: Record<string, unknown> | Record<string, unknown>[]) => {
        const row = Array.isArray(data) ? data[0] : data;
        applyActiveTimerRow(row);
      },
      onTimerStopped: (data: Record<string, unknown>) => {
        const itemId = Number(data.item_id);
        if (Number.isFinite(itemId)) {
          setTimers((prev) => prev.map((t) => (t.id === itemId ? { ...t, isRunning: false, startedAtMs: null } : t)));
          setLoadedTimerId((prev) => (prev === itemId ? null : prev));
        }
      },
      onTimersStopped: () => {
        setTimers((prev) => prev.map((t) => ({ ...t, isRunning: false, startedAtMs: null })));
        setLoadedTimerId(null);
      },
      onResetAllStates: () => {
        setTimers((prev) => prev.map((t) => ({ ...t, remainingMs: t.durationMs, isRunning: false, startedAtMs: null })));
        setLoadedTimerId(null);
      },
      onConnectionChange: (connected: boolean) => {
        if (connected && !cancelled) void hydrateFromApi();
      },
    };

    void hydrateFromApi();
    const unsub = socketClient.connect(eventId, callbacks);

    const handleVisibilityChange = () => {
      if (!document.hidden && !socketClient.isConnected()) {
        void hydrateFromApi();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsub();
    };
  }, [eventId]);

  const totals = useMemo(() => {
    const active = timers.filter((t) => t.isRunning).length;
    const done = timers.filter((t) => nowRemainingMs(t, nowMs) <= 0).length;
    return { active, done };
  }, [timers, nowMs]);

  const runningTimers = useMemo(() => timers.filter((t) => t.isRunning), [timers]);
  const selectedTimer = timers.find((t) => t.id === selectedTimerId) || null;
  const selectedState = selectedTimer ? timerState(selectedTimer, nowMs, loadedTimerId) : 'READY';
  const selectedRemaining = selectedTimer ? nowRemainingMs(selectedTimer, nowMs) : 0;

  const callApi = async (path: string, method: 'POST' | 'PUT', body: Record<string, any>) => {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  };

  const addTimer = () => {
    const minutes = Math.max(0, Number.parseInt(minutesDraft || '0', 10) || 0);
    const seconds = Math.max(0, Number.parseInt(secondsDraft || '0', 10) || 0);
    const durationMs = clampDurationMs((minutes * 60 + seconds) * 1000 || 60 * 1000);
    const nextId = timers.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    const next: QuickTimer = {
      id: nextId,
      title: titleDraft.trim() || `Timer ${timers.length + 1}`,
      cue: `CUE ${nextId}`,
      durationMs,
      remainingMs: durationMs,
      isRunning: false,
      startedAtMs: null
    };
    setTimers((prev) => [...prev, next]);
    setSelectedTimerId(next.id);
    setTitleDraft('');
  };

  const updateTitle = (id: number, title: string) => setTimers((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));

  const loadTimer = async (id: number) => {
    const timer = timers.find((t) => t.id === id);
    if (!timer) return;
    const now = Date.now();
    setTimers((prev) => prev.map((t) => ({ ...t, remainingMs: nowRemainingMs(t, now), isRunning: false, startedAtMs: null })));
    setLoadedTimerId(id);
    setSelectedTimerId(id);
    if (!eventId) return;
    const durationSeconds = Math.max(1, Math.floor(timer.durationMs / 1000));
    try {
      await callApi('/api/active-timers', 'POST', {
        event_id: eventId,
        item_id: id,
        user_id: 'quick-mode',
        timer_state: 'loaded',
        is_active: true,
        is_running: false,
        started_at: null,
        last_loaded_cue_id: id,
        cue_is: timer.cue,
        duration_seconds: durationSeconds
      });
    } catch {
      // local still works
    }
  };

  const startStopTimer = async (id: number) => {
    const timer = timers.find((t) => t.id === id);
    if (!timer) return;
    if (timer.isRunning) {
      const stopAt = Date.now();
      setTimers((prev) => prev.map((t) => (t.id === id ? { ...t, remainingMs: nowRemainingMs(t, stopAt), isRunning: false, startedAtMs: null } : t)));
      if (loadedTimerId === id) setLoadedTimerId(null);
      if (eventId) {
        try {
          await callApi('/api/active-timers/stop', 'PUT', {
            event_id: eventId,
            item_id: id,
            user_id: 'quick-mode',
            user_name: 'Quick Mode',
            user_role: 'OPERATOR'
          });
        } catch {
          // local state already updated
        }
      }
      return;
    }
    if (loadedTimerId !== id) {
      await loadTimer(id);
    }
    const startAt = Date.now();
    setTimers((prev) =>
      prev.map((t) => {
        if (t.id !== id) return { ...t, remainingMs: nowRemainingMs(t, startAt), isRunning: false, startedAtMs: null };
        const remaining = nowRemainingMs(t, startAt);
        return { ...t, remainingMs: remaining <= 0 ? t.durationMs : remaining, isRunning: true, startedAtMs: startAt };
      })
    );
    setLoadedTimerId(id);
    if (!eventId) return;
    const durationSeconds = Math.max(1, Math.floor(timer.durationMs / 1000));
    try {
      await callApi('/api/active-timers', 'POST', {
        event_id: eventId,
        item_id: id,
        user_id: 'quick-mode',
        timer_state: 'running',
        is_active: true,
        is_running: true,
        started_at: new Date(startAt).toISOString(),
        last_loaded_cue_id: id,
        cue_is: timer.cue,
        duration_seconds: durationSeconds
      });
    } catch {
      // local still works
    }
  };

  const resetTimer = async (id: number) => {
    setTimers((prev) => prev.map((t) => (t.id === id ? { ...t, remainingMs: t.durationMs, isRunning: false, startedAtMs: null } : t)));
    if (loadedTimerId === id) setLoadedTimerId(null);
    if (!eventId) return;
    try {
      await callApi('/api/timers/reset', 'POST', { event_id: eventId, item_id: id });
    } catch {
      // local state already reset
    }
  };

  const removeTimer = (id: number) => {
    setTimers((prev) => prev.filter((t) => t.id !== id));
    if (loadedTimerId === id) setLoadedTimerId(null);
    if (selectedTimerId === id) setSelectedTimerId(null);
  };

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col bg-slate-900 text-white pt-16">
      <header className="shrink-0 border-b border-slate-700 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 px-3 py-2 md:px-4">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-600 text-slate-300 hover:border-slate-500 hover:bg-slate-800 hover:text-white"
              aria-label="Back to event list"
              title="Back to event list"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="hidden h-7 w-px shrink-0 bg-slate-600/80 sm:block" aria-hidden />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base font-bold md:text-lg">Quick Mode</h1>
                <span className="px-2 py-0.5 rounded bg-amber-600 text-black text-[10px] font-bold uppercase tracking-wide">
                  Offline Show
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    connectivity?.cloudConnected
                      ? 'bg-sky-800 text-sky-100 border border-sky-600'
                      : 'bg-orange-900/90 text-orange-100 border border-orange-700'
                  }`}
                >
                  {connectivity?.cloudConnected ? 'Cloud on' : 'LAN only'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Ad-hoc timers · syncs via local show server (:3004)</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-[11px] text-slate-200">
              Event ID: <span className="font-mono text-purple-300">{eventId || 'loading...'}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!eventId) return;
                window.open(
                  `/timer?eventId=${encodeURIComponent(eventId)}`,
                  'offlineShowTimer',
                  'width=1920,height=1080,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes'
                );
              }}
              className="rounded border border-emerald-500/70 px-2 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-900/30"
            >
              Open timer display
            </button>
            <span className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[10px] text-slate-300">
              {isCompanionSyncing ? 'Syncing…' : syncMessage || 'Waiting for first timer…'}
            </span>
            <span className="rounded bg-slate-700 px-2 py-1 text-[10px]">Total: {timers.length}</span>
            <span className="rounded bg-emerald-900/70 px-2 py-1 text-[10px] text-emerald-200">Running: {totals.active}</span>
            <span className="rounded bg-amber-900/70 px-2 py-1 text-[10px] text-amber-200">Done: {totals.done}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 overflow-hidden">
        <aside className="hidden w-56 shrink-0 border-r border-slate-700 bg-slate-950 lg:block">
          <div className="border-b border-slate-800 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Quick Cues
          </div>
          <div className="min-h-0 max-h-full overflow-y-auto p-2">
            {timers.map((t) => {
              const state = timerState(t, nowMs, loadedTimerId);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTimerId(t.id)}
                  className={`mb-1.5 w-full rounded border px-2 py-1.5 text-left ${
                    selectedTimerId === t.id ? 'border-cyan-500 bg-cyan-950/30' : 'border-slate-700 bg-slate-900/70 hover:bg-slate-800'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-300">{t.cue}</div>
                  <div className="truncate text-xs font-semibold text-white">{t.title}</div>
                  <div className="mt-1 text-[10px] text-slate-400">{state}</div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-slate-900 p-2.5 md:p-3">
          <section className="mb-2 rounded-lg border border-slate-600 bg-slate-800 p-2.5 shadow-lg">
            <div className="grid gap-3 md:grid-cols-[1.4fr_auto_auto_auto]">
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                placeholder="Timer name (optional)"
                className="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              />
              <input
                type="number"
                min={0}
                value={minutesDraft}
                onChange={(e) => setMinutesDraft(e.target.value)}
                className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 md:w-24"
                aria-label="Minutes"
              />
              <input
                type="number"
                min={0}
                value={secondsDraft}
                onChange={(e) => setSecondsDraft(e.target.value)}
                className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 md:w-24"
                aria-label="Seconds"
              />
              <button type="button" onClick={addTimer} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">
                + Add timer
              </button>
            </div>
          </section>

          {selectedTimer ? (
            <section className="mb-2 rounded-lg border border-slate-600 bg-slate-800 p-2.5 shadow-lg">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-700 px-2 py-1 text-[10px] font-bold">{selectedTimer.cue}</span>
                <span className={`rounded px-2 py-1 text-[10px] font-bold ${
                  selectedState === 'RUNNING' ? 'bg-emerald-900/50 text-emerald-200' :
                  selectedState === 'DONE' ? 'bg-amber-900/50 text-amber-200' :
                  selectedState === 'LOADED' ? 'bg-blue-900/60 text-blue-200' : 'bg-slate-700 text-slate-300'
                }`}>{selectedState}</span>
                <span className="rounded bg-slate-700 px-2 py-1 text-[10px] text-slate-300">Remaining: {formatTime(selectedRemaining)}</span>
                <span className="rounded bg-slate-700 px-2 py-1 text-[10px] text-slate-300">Base: {formatTime(selectedTimer.durationMs)}</span>
                <div className="ml-auto flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => loadTimer(selectedTimer.id)}
                    disabled={loadedTimerId === selectedTimer.id}
                    className={`rounded px-2.5 py-1 text-[10px] font-semibold ${
                      loadedTimerId === selectedTimer.id ? 'bg-blue-600 text-white cursor-default' : 'border border-blue-400/80 bg-blue-700/80 text-blue-50 hover:bg-blue-600'
                    }`}
                  >
                    {loadedTimerId === selectedTimer.id ? 'LOADED' : 'LOAD'}
                  </button>
                  <button
                    type="button"
                    onClick={() => startStopTimer(selectedTimer.id)}
                    disabled={!selectedTimer.isRunning && !(loadedTimerId === selectedTimer.id && runningTimers.length === 0)}
                    className={`rounded px-2.5 py-1 text-[10px] font-semibold ${
                      selectedTimer.isRunning
                        ? 'bg-red-600 text-white hover:bg-red-500'
                        : loadedTimerId === selectedTimer.id && runningTimers.length === 0
                        ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                        : 'bg-slate-600 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {selectedTimer.isRunning ? 'STOP' : 'START'}
                  </button>
                  <button type="button" onClick={() => resetTimer(selectedTimer.id)} className="rounded border border-slate-500 px-2.5 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-700">
                    Reset
                  </button>
                  <button type="button" onClick={() => removeTimer(selectedTimer.id)} className="rounded border border-red-500/70 px-2.5 py-1 text-[10px] font-semibold text-red-200 hover:bg-red-900/30">
                    Remove
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={selectedTimer.title}
                onChange={(e) => updateTitle(selectedTimer.id, e.target.value)}
                className="mt-2 w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-blue-500"
              />
            </section>
          ) : null}

          {timers.length > 0 ? (
            <section className="overflow-hidden rounded-lg border border-slate-600 bg-slate-800 shadow-lg">
              <div className="border-b border-slate-600 bg-slate-700 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-200">
                Quick Rundown
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead className="bg-slate-700/80">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-300">Cue</th>
                      <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-300">Segment</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-semibold text-slate-300">Duration</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-semibold text-slate-300">Remaining</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-semibold text-slate-300">State</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-semibold text-slate-300">Controls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timers.map((timer) => {
                      const state = timerState(timer, nowMs, loadedTimerId);
                      const remaining = nowRemainingMs(timer, nowMs);
                      return (
                        <tr
                          key={timer.id}
                          onClick={() => setSelectedTimerId(timer.id)}
                          className={`cursor-pointer border-t border-slate-700 ${
                            state === 'LOADED' ? 'bg-blue-900/55 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.55)] hover:bg-blue-900/65' :
                            selectedTimerId === timer.id ? 'bg-cyan-950/25' : 'hover:bg-slate-700/40'
                          }`}
                        >
                          <td className="px-2 py-1.5 font-mono text-[11px] text-slate-200">{timer.cue}</td>
                          <td className="px-2 py-1.5 text-xs text-white">{timer.title || 'Untitled timer'}</td>
                          <td className="px-2 py-1.5 text-center font-mono text-[11px] text-slate-300">{formatTime(timer.durationMs)}</td>
                          <td className="px-2 py-1.5 text-center font-mono text-xs text-white">{formatTime(remaining)}</td>
                          <td className="px-2 py-1.5 text-center">
                            <span className={`rounded px-2 py-1 text-[10px] font-bold ${
                              state === 'RUNNING' ? 'bg-emerald-900/50 text-emerald-200' :
                              state === 'DONE' ? 'bg-amber-900/50 text-amber-200' :
                              state === 'LOADED' ? 'bg-blue-900/60 text-blue-200' : 'bg-slate-700 text-slate-300'
                            }`}>{state}</span>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <div className="flex justify-center gap-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  loadTimer(timer.id);
                                }}
                                disabled={loadedTimerId === timer.id}
                                className={`rounded px-2 py-1 text-[10px] font-semibold ${
                                  loadedTimerId === timer.id ? 'bg-blue-600 text-white cursor-default' : 'border border-blue-400/80 bg-blue-700/80 text-blue-50 hover:bg-blue-600'
                                }`}
                              >
                                {loadedTimerId === timer.id ? 'LOADED' : 'LOAD'}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startStopTimer(timer.id);
                                }}
                                disabled={!timer.isRunning && !(loadedTimerId === timer.id && runningTimers.length === 0)}
                                className={`rounded px-2 py-1 text-[10px] font-semibold ${
                                  timer.isRunning
                                    ? 'bg-red-600 text-white hover:bg-red-500'
                                    : loadedTimerId === timer.id && runningTimers.length === 0
                                    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                                    : 'bg-slate-600 text-slate-400 cursor-not-allowed'
                                }`}
                              >
                                {timer.isRunning ? 'STOP' : 'START'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-600 bg-slate-800/50 p-6 text-center text-slate-400">
              No quick timers yet. Add one above to get started.
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default QuickModePage;
