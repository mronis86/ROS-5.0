import React, { useCallback, useEffect, useState } from 'react';
import { DatabaseService } from '../services/database';
import {
  durationFromParts,
  formatOperatorCountdownTime,
  loadOperatorTimerPresets,
  mapOperatorCountdownRow,
  OperatorCountdownDisplay,
  operatorCountdownRemaining,
  OperatorTimerPreset,
  parseDurationParts,
  saveOperatorTimerPresets,
} from '../lib/operatorCountdown';
import { startSecondTicker } from '../utils/secondTicker';

type OperatorCountdownModalProps = {
  isOpen: boolean;
  eventId: string;
  userId?: string;
  userName?: string;
  userRole?: string;
  /** Live timer from Run of Show (WebSocket). */
  liveCountdown?: OperatorCountdownDisplay | null;
  onClose: () => void;
  onStarted: () => void;
  onCleared: () => void;
  onLiveRow?: (row: ReturnType<typeof mapOperatorCountdownRow>) => void;
};

const OperatorCountdownModal: React.FC<OperatorCountdownModalProps> = ({
  isOpen,
  eventId,
  userId,
  userName,
  userRole,
  liveCountdown,
  onClose,
  onStarted,
  onCleared,
  onLiveRow,
}) => {
  const [presets, setPresets] = useState<OperatorTimerPreset[]>([]);
  const [customLabel, setCustomLabel] = useState('Custom');
  const [customMinutes, setCustomMinutes] = useState(5);
  const [customSeconds, setCustomSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  const isLive = !!(liveCountdown?.is_active && liveCountdown?.is_running);

  useEffect(() => {
    if (!isOpen || !isLive) return;
    return startSecondTicker(() => tick((n) => n + 1));
  }, [isOpen, isLive, liveCountdown?.started_at]);

  useEffect(() => {
    if (!isOpen || !eventId) return;
    setPresets(loadOperatorTimerPresets(eventId));
    setError(null);
  }, [isOpen, eventId]);

  const persistPresets = (next: OperatorTimerPreset[]) => {
    setPresets(next);
    saveOperatorTimerPresets(eventId, next);
  };

  const updatePreset = (id: string, patch: Partial<OperatorTimerPreset>) => {
    persistPresets(
      presets.map((p) => (p.id === id ? { ...p, ...patch } : p))
    );
  };

  const runTimer = async (label: string, duration_seconds: number) => {
    setBusy(true);
    setError(null);
    try {
      const { data: row, error: startError } = await DatabaseService.startOperatorCountdown(eventId, {
        userId,
        userName,
        userRole,
        label: label.trim() || 'Operator Timer',
        duration_seconds,
      });
      if (!row) {
        setError(
          startError
            ? `Could not start timer (${startError}). If this persists, Railway may still be deploying or migration 072 needs to run.`
            : 'Could not start timer on Clock / Full Screen.'
        );
        return;
      }
      onLiveRow?.(mapOperatorCountdownRow(row));
      onStarted();
    } catch (e) {
      console.error(e);
      setError('Start failed.');
    } finally {
      setBusy(false);
    }
  };

  const adjust = async (delta_seconds: number) => {
    setBusy(true);
    setError(null);
    try {
      const row = await DatabaseService.adjustOperatorCountdown(eventId, { delta_seconds });
      if (!row) {
        setError('Adjust failed — is a timer running?');
        return;
      }
      onLiveRow?.(mapOperatorCountdownRow(row));
      onStarted();
    } finally {
      setBusy(false);
    }
  };

  const restartCurrent = async () => {
    if (!liveCountdown) return;
    setBusy(true);
    setError(null);
    try {
      const row = await DatabaseService.adjustOperatorCountdown(eventId, {
        restart: true,
        duration_seconds: liveCountdown.duration_seconds,
      });
      if (!row) {
        setError('Restart failed.');
        return;
      }
      onLiveRow?.(mapOperatorCountdownRow(row));
      onStarted();
    } finally {
      setBusy(false);
    }
  };

  const clearDisplays = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await DatabaseService.clearOperatorCountdown(eventId);
      if (!ok) {
        setError('Clear failed.');
        return;
      }
      onLiveRow?.(null);
      onCleared();
    } finally {
      setBusy(false);
    }
  };

  const applyCustomToEditors = useCallback((seconds: number, label?: string) => {
    const parts = parseDurationParts(seconds);
    setCustomMinutes(parts.minutes);
    setCustomSeconds(parts.seconds);
    if (label != null) setCustomLabel(label);
  }, []);

  if (!isOpen) return null;

  const remaining = isLive ? operatorCountdownRemaining(liveCountdown) : null;
  const displayTime =
    remaining != null ? formatOperatorCountdownTime(remaining) : '--:--';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-600 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-5 py-4">
          <div>
            <h3 className="text-xl font-bold text-white">Operator timers</h3>
            <p className="mt-1 text-sm text-slate-400">
              Run presets or a custom time. It shows on Clock / Full Screen in the same ALT
              slot as indented sub-timers (sub-cue wins if both are running).
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4">
          {/* Live readout */}
          <div
            className={`rounded-lg border px-4 py-4 text-center ${
              isLive ? 'border-violet-500/50 bg-violet-950/40' : 'border-slate-700 bg-slate-800/60'
            }`}
          >
            <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              {isLive ? 'On Clock / Full Screen' : 'Not running'}
            </div>
            {isLive && liveCountdown ? (
              <>
                <div className="mt-1 text-sm font-medium text-violet-200">{liveCountdown.cue_display}</div>
                <div className="mt-2 font-mono text-5xl font-bold tabular-nums text-white">{displayTime}</div>
              </>
            ) : (
              <div className="mt-2 font-mono text-3xl text-slate-500">—</div>
            )}

            {isLive && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void adjust(-60)}
                  className="rounded bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-600 disabled:opacity-50"
                >
                  −1 min
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void adjust(-30)}
                  className="rounded bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-600 disabled:opacity-50"
                >
                  −30s
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void adjust(30)}
                  className="rounded bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-600 disabled:opacity-50"
                >
                  +30s
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void adjust(60)}
                  className="rounded bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-600 disabled:opacity-50"
                >
                  +1 min
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void restartCurrent()}
                  className="rounded bg-amber-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  Reset
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void clearDisplays()}
                  className="rounded bg-slate-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-500 disabled:opacity-50"
                >
                  Stop & clear
                </button>
              </div>
            )}
          </div>

          {/* Saved presets */}
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-200">Preset timers</h4>
            <div className="space-y-2">
              {presets.map((p) => {
                const parts = parseDurationParts(p.duration_seconds);
                return (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-slate-700 bg-slate-800/80 p-2"
                  >
                    <input
                      type="text"
                      value={p.label}
                      onChange={(e) => updatePreset(p.id, { label: e.target.value })}
                      className="min-w-[5rem] flex-1 rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm text-white"
                    />
                    <input
                      type="number"
                      min={0}
                      max={999}
                      value={parts.minutes}
                      onChange={(e) =>
                        updatePreset(p.id, {
                          duration_seconds: durationFromParts(Number(e.target.value), parts.seconds),
                        })
                      }
                      className="w-14 rounded border border-slate-600 bg-slate-950 px-1 py-1.5 text-sm text-white"
                      aria-label="Minutes"
                    />
                    <span className="text-xs text-slate-500">m</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={parts.seconds}
                      onChange={(e) =>
                        updatePreset(p.id, {
                          duration_seconds: durationFromParts(parts.minutes, Number(e.target.value)),
                        })
                      }
                      className="w-14 rounded border border-slate-600 bg-slate-950 px-1 py-1.5 text-sm text-white"
                      aria-label="Seconds"
                    />
                    <span className="text-xs text-slate-500">s</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runTimer(p.label, p.duration_seconds)}
                      className="rounded bg-violet-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50"
                    >
                      Run
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">Presets are saved per event on this browser.</p>
          </div>

          {/* Custom one-off */}
          <div className="rounded-md border border-slate-700 bg-slate-800/40 p-3">
            <h4 className="mb-2 text-sm font-semibold text-slate-200">Custom</h4>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                className="min-w-[6rem] flex-1 rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm text-white"
              />
              <input
                type="number"
                min={0}
                max={999}
                value={customMinutes}
                onChange={(e) => setCustomMinutes(Number(e.target.value))}
                className="w-14 rounded border border-slate-600 bg-slate-950 px-1 py-1.5 text-sm text-white"
              />
              <span className="text-xs text-slate-500">m</span>
              <input
                type="number"
                min={0}
                max={59}
                value={customSeconds}
                onChange={(e) => setCustomSeconds(Number(e.target.value))}
                className="w-14 rounded border border-slate-600 bg-slate-950 px-1 py-1.5 text-sm text-white"
              />
              <span className="text-xs text-slate-500">s</span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runTimer(customLabel, durationFromParts(customMinutes, customSeconds))
                }
                className="rounded bg-violet-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50"
              >
                Run
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                { label: '1:00', s: 60 },
                { label: '2:00', s: 120 },
                { label: '5:00', s: 300 },
              ].map((q) => (
                <button
                  key={q.s}
                  type="button"
                  onClick={() => applyCustomToEditors(q.s)}
                  className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
              {error}
            </p>
          )}
        </div>

        <div className="border-t border-slate-700 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-md border border-slate-600 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            Close panel
          </button>
        </div>
      </div>
    </div>
  );
};

export default OperatorCountdownModal;
