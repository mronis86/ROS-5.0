import React, { useEffect, useMemo, useState } from 'react';
import {
  applyOffsetToDisplayTime,
  normalizeMarkerAbsoluteSeconds,
  normalizeMarkerOffsetSeconds,
  normalizeMarkerTimeMode,
  parseClockToSeconds,
  secondsToDisplayTime,
  TimedMarkerMode,
} from '../lib/timedMarker';

export type { TimedMarkerMode };

export type TimedMarkerModalResult = {
  mode: TimedMarkerMode;
  /** Seconds after parent start (offset mode). */
  markerOffsetSeconds: number;
  /** Seconds since midnight (absolute mode). */
  markerAbsoluteSeconds: number;
  label: string;
};

type TimedMarkerModalProps = {
  isOpen: boolean;
  parentSegmentName: string;
  parentStartDisplay: string;
  initialMode?: TimedMarkerMode;
  initialOffsetSeconds?: number;
  initialAbsoluteSeconds?: number;
  initialLabel?: string;
  title?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (result: TimedMarkerModalResult) => void;
};

function formatOffsetLabel(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m${sec ? ` ${sec}s` : ''}`;
  if (m > 0) return `${m}m${sec ? ` ${sec}s` : ''}`;
  return `${sec}s`;
}

const TimedMarkerModal: React.FC<TimedMarkerModalProps> = ({
  isOpen,
  parentSegmentName,
  parentStartDisplay,
  initialMode = 'absolute',
  initialOffsetSeconds = 0,
  initialAbsoluteSeconds,
  initialLabel = 'Timed marker',
  title = 'Add Timed Marker',
  confirmLabel = 'Add marker',
  onClose,
  onConfirm,
}) => {
  const [mode, setMode] = useState<TimedMarkerMode>('absolute');
  const [absoluteRaw, setAbsoluteRaw] = useState('');
  const [offsetMinutes, setOffsetMinutes] = useState(0);
  const [offsetSeconds, setOffsetSeconds] = useState(0);
  const [label, setLabel] = useState('Timed marker');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const nextMode = normalizeMarkerTimeMode(initialMode);
    setMode(nextMode);
    setLabel(initialLabel || 'Timed marker');
    setError(null);
    const offset = normalizeMarkerOffsetSeconds(initialOffsetSeconds);
    setOffsetMinutes(Math.floor(offset / 60));
    setOffsetSeconds(offset % 60);

    if (initialAbsoluteSeconds != null && Number.isFinite(Number(initialAbsoluteSeconds))) {
      setAbsoluteRaw(secondsToDisplayTime(normalizeMarkerAbsoluteSeconds(initialAbsoluteSeconds)));
    } else if (parentStartDisplay) {
      setAbsoluteRaw(
        nextMode === 'offset'
          ? applyOffsetToDisplayTime(parentStartDisplay, offset)
          : parentStartDisplay
      );
    } else {
      setAbsoluteRaw('');
    }
  }, [
    isOpen,
    initialMode,
    initialOffsetSeconds,
    initialAbsoluteSeconds,
    initialLabel,
    parentStartDisplay,
  ]);

  const preview = useMemo(() => {
    if (mode === 'absolute') {
      const absSec = parseClockToSeconds(absoluteRaw);
      return {
        display: absSec == null ? '' : secondsToDisplayTime(absSec),
        detail:
          absSec == null
            ? 'Enter a wall-clock time'
            : 'Stays at this clock time — does not move with parent overtime',
      };
    }
    const offsetSec = Math.max(0, offsetMinutes * 60 + offsetSeconds);
    return {
      display: parentStartDisplay
        ? applyOffsetToDisplayTime(parentStartDisplay, offsetSec)
        : '',
      detail: `+${formatOffsetLabel(offsetSec)} after parent — slides with parent over/under`,
    };
  }, [mode, parentStartDisplay, absoluteRaw, offsetMinutes, offsetSeconds]);

  if (!isOpen) return null;

  const submit = () => {
    setError(null);
    if (mode === 'absolute') {
      const absSec = parseClockToSeconds(absoluteRaw);
      if (absSec == null) {
        setError('Could not parse that time. Try 7:20 AM or 07:20.');
        return;
      }
      onConfirm({
        mode: 'absolute',
        markerAbsoluteSeconds: absSec,
        markerOffsetSeconds: 0,
        label: label.trim() || 'Timed marker',
      });
      return;
    }

    if (!parentStartDisplay) {
      setError('Parent cue has no start time yet. Set a day start time first.');
      return;
    }
    const offsetSec = Math.max(0, offsetMinutes * 60 + offsetSeconds);
    onConfirm({
      mode: 'offset',
      markerOffsetSeconds: offsetSec,
      markerAbsoluteSeconds: 0,
      label: label.trim() || 'Timed marker',
    });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-600 bg-slate-900 shadow-xl">
        <div className="border-b border-slate-700 px-5 py-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-slate-400">
            Grouped under <span className="text-slate-200">{parentSegmentName || 'cue'}</span>
            {parentStartDisplay ? (
              <>
                {' '}
                · parent starts <span className="font-mono text-sky-300">{parentStartDisplay}</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="flex rounded-lg border border-slate-700 overflow-hidden">
            <button
              type="button"
              onClick={() => setMode('absolute')}
              className={`flex-1 px-3 py-2 text-sm font-semibold ${
                mode === 'absolute'
                  ? 'bg-sky-700 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
              }`}
            >
              Absolute clock
            </button>
            <button
              type="button"
              onClick={() => setMode('offset')}
              className={`flex-1 px-3 py-2 text-sm font-semibold border-l border-slate-700 ${
                mode === 'offset'
                  ? 'bg-sky-700 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-750'
              }`}
            >
              Offset from parent
            </button>
          </div>

          <p className="text-xs text-slate-400">
            {mode === 'absolute'
              ? 'Fixed wall-clock time (e.g. 7:20 AM). Stays put when the parent runs over or under.'
              : 'Time relative to the parent start (e.g. +20 min). Moves with the parent when overtime slides it.'}
          </p>

          {mode === 'absolute' ? (
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Start time
              </span>
              <input
                type="text"
                value={absoluteRaw}
                onChange={(e) => setAbsoluteRaw(e.target.value)}
                placeholder="7:20 AM"
                className="w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-white"
                autoFocus
              />
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Minutes
                </span>
                <input
                  type="number"
                  min={0}
                  value={offsetMinutes}
                  onChange={(e) => setOffsetMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-white"
                  autoFocus
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Seconds
                </span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={offsetSeconds}
                  onChange={(e) =>
                    setOffsetSeconds(Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))
                  }
                  className="w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-white"
                />
              </label>
            </div>
          )}

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Label
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-white"
            />
          </label>

          <div className="rounded-lg border border-sky-800/50 bg-sky-950/30 px-3 py-2 text-sm text-sky-100">
            <div>
              Shows as:{' '}
              <span className="font-mono font-bold">{preview.display || '—'}</span>
            </div>
            <div className="text-xs text-sky-300/80 mt-0.5">{preview.detail}</div>
          </div>

          {error ? (
            <div className="rounded-md border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-700 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TimedMarkerModal;
