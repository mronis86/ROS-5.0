import React, { useEffect, useMemo, useState } from 'react';

type QuickTimer = {
  id: string;
  title: string;
  durationMs: number;
  remainingMs: number;
  isRunning: boolean;
  startedAtMs: number | null;
};

const STORAGE_KEY = 'ros.quickMode.timers.v1';

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

const QuickModePage: React.FC = () => {
  const [timers, setTimers] = useState<QuickTimer[]>([]);
  const [titleDraft, setTitleDraft] = useState('');
  const [minutesDraft, setMinutesDraft] = useState('5');
  const [secondsDraft, setSecondsDraft] = useState('0');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as QuickTimer[];
      if (!Array.isArray(parsed)) return;
      const hydrated = parsed
        .filter((t) => t && typeof t.id === 'string')
        .map((t) => ({
          id: t.id,
          title: typeof t.title === 'string' && t.title.trim() ? t.title : 'Quick Timer',
          durationMs: clampDurationMs(Number(t.durationMs) || 5 * 60 * 1000),
          remainingMs: Math.max(0, Number(t.remainingMs) || 5 * 60 * 1000),
          // Do not auto-resume running timers after refresh.
          isRunning: false,
          startedAtMs: null
        }));
      setTimers(hydrated);
    } catch {
      // ignore invalid localStorage data
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      const snapshot = timers.map((t) => ({
        ...t,
        remainingMs: nowRemainingMs(t, Date.now()),
        isRunning: false,
        startedAtMs: null
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore storage failures
    }
  }, [timers]);

  const totals = useMemo(() => {
    const active = timers.filter((t) => t.isRunning).length;
    const done = timers.filter((t) => nowRemainingMs(t, nowMs) <= 0).length;
    return { active, done };
  }, [timers, nowMs]);

  const addTimer = () => {
    const minutes = Math.max(0, Number.parseInt(minutesDraft || '0', 10) || 0);
    const seconds = Math.max(0, Number.parseInt(secondsDraft || '0', 10) || 0);
    const durationMs = clampDurationMs((minutes * 60 + seconds) * 1000 || 60 * 1000);
    const next: QuickTimer = {
      id: `quick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: titleDraft.trim() || `Timer ${timers.length + 1}`,
      durationMs,
      remainingMs: durationMs,
      isRunning: false,
      startedAtMs: null
    };
    setTimers((prev) => [next, ...prev]);
    setTitleDraft('');
  };

  const clearAll = () => {
    if (!window.confirm('Clear all quick timers?')) return;
    setTimers([]);
  };

  const updateTitle = (id: string, title: string) => {
    setTimers((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  };

  const startTimer = (id: string) => {
    const startAt = Date.now();
    setTimers((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const remaining = nowRemainingMs(t, startAt);
        const nextRemaining = remaining <= 0 ? t.durationMs : remaining;
        return { ...t, remainingMs: nextRemaining, isRunning: true, startedAtMs: startAt };
      })
    );
  };

  const pauseTimer = (id: string) => {
    const pausedAt = Date.now();
    setTimers((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        return { ...t, remainingMs: nowRemainingMs(t, pausedAt), isRunning: false, startedAtMs: null };
      })
    );
  };

  const resetTimer = (id: string) => {
    setTimers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, remainingMs: t.durationMs, isRunning: false, startedAtMs: null } : t))
    );
  };

  const removeTimer = (id: string) => {
    setTimers((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="min-h-screen bg-slate-900 px-4 pb-8 pt-24 text-white md:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 rounded-xl border border-slate-700 bg-slate-800/80 p-4 md:p-5">
          <h1 className="text-2xl font-bold">Quick Mode</h1>
          <p className="mt-1 text-sm text-slate-300">
            Fast last-minute timers without building a full Run of Show. Saved on this browser.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
            <span className="rounded bg-slate-700 px-2 py-1">Total: {timers.length}</span>
            <span className="rounded bg-emerald-900/70 px-2 py-1 text-emerald-200">Running: {totals.active}</span>
            <span className="rounded bg-amber-900/70 px-2 py-1 text-amber-200">Done: {totals.done}</span>
          </div>
        </div>

        <div className="mb-5 rounded-xl border border-slate-700 bg-slate-800/80 p-4 md:p-5">
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
            <button
              type="button"
              onClick={addTimer}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
              + Add timer
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setMinutesDraft('1');
                setSecondsDraft('0');
              }}
              className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
            >
              1:00
            </button>
            <button
              type="button"
              onClick={() => {
                setMinutesDraft('5');
                setSecondsDraft('0');
              }}
              className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
            >
              5:00
            </button>
            <button
              type="button"
              onClick={() => {
                setMinutesDraft('10');
                setSecondsDraft('0');
              }}
              className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
            >
              10:00
            </button>
            {timers.length > 0 ? (
              <button
                type="button"
                onClick={clearAll}
                className="ml-auto rounded border border-red-500/70 px-3 py-1 text-xs font-semibold text-red-200 hover:bg-red-900/30"
              >
                Clear all
              </button>
            ) : null}
          </div>
        </div>

        <div className="space-y-3">
          {timers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-600 bg-slate-800/50 p-6 text-center text-slate-400">
              No quick timers yet. Add one above to get started.
            </div>
          ) : (
            timers.map((timer) => {
              const remaining = nowRemainingMs(timer, nowMs);
              const isDone = remaining <= 0;
              return (
                <div
                  key={timer.id}
                  className={`rounded-xl border p-3 md:p-4 ${
                    isDone ? 'border-amber-600 bg-amber-950/35' : 'border-slate-700 bg-slate-800/75'
                  }`}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <input
                      type="text"
                      value={timer.title}
                      onChange={(e) => updateTitle(timer.id, e.target.value)}
                      className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                    />
                    <div className={`min-w-[7.5rem] text-right font-mono text-3xl ${isDone ? 'text-amber-300' : 'text-white'}`}>
                      {formatTime(remaining)}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {timer.isRunning ? (
                      <button
                        type="button"
                        onClick={() => pauseTimer(timer.id)}
                        className="rounded bg-yellow-600 px-3 py-1.5 text-xs font-semibold hover:bg-yellow-500"
                      >
                        Pause
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startTimer(timer.id)}
                        className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-500"
                      >
                        Start
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => resetTimer(timer.id)}
                      className="rounded border border-slate-500 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTimer(timer.id)}
                      className="rounded border border-red-500/70 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-900/30"
                    >
                      Remove
                    </button>
                    <span className="ml-auto rounded bg-slate-700 px-2 py-1 text-xs text-slate-200">
                      Base: {formatTime(timer.durationMs)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickModePage;
