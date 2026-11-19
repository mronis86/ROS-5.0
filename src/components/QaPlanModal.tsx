import React, { useEffect, useMemo, useState } from 'react';
import {
  clampQaDurationSeconds,
  defaultQaPlanDraft,
  formatClockFromSeconds,
  resolveQaStartAtRemaining,
  type QaDisplayMode,
  type QaPlanModalResult,
  type QaStartMode,
} from '../lib/qaPlan';

type Props = {
  isOpen: boolean;
  parentSegmentName: string;
  parentDurationSeconds: number;
  onClose: () => void;
  onConfirm: (result: QaPlanModalResult) => void;
};

function partsFromSeconds(total: number): { minutes: number; seconds: number } {
  const s = Math.max(0, Math.floor(total));
  return { minutes: Math.floor(s / 60), seconds: s % 60 };
}

const QaPlanModal: React.FC<Props> = ({
  isOpen,
  parentSegmentName,
  parentDurationSeconds,
  onClose,
  onConfirm,
}) => {
  const [label, setLabel] = useState('Q&A');
  const [displayMode, setDisplayMode] = useState<QaDisplayMode>('sub');
  const [durationMin, setDurationMin] = useState(10);
  const [durationSec, setDurationSec] = useState(0);
  const [startMode, setStartMode] = useState<QaStartMode>('end');
  const [remainMin, setRemainMin] = useState(20);
  const [remainSec, setRemainSec] = useState(0);
  const [autoStart, setAutoStart] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const draft = defaultQaPlanDraft(parentDurationSeconds);
    const dur = partsFromSeconds(draft.durationSeconds);
    setLabel(draft.label);
    setDisplayMode('sub');
    setDurationMin(dur.minutes);
    setDurationSec(dur.seconds);
    setStartMode('end');
    const remain = partsFromSeconds(
      parentDurationSeconds > 0
        ? Math.min(parentDurationSeconds, Math.max(draft.durationSeconds, Math.floor(parentDurationSeconds / 2)))
        : 20 * 60
    );
    setRemainMin(remain.minutes);
    setRemainSec(remain.seconds);
    setAutoStart(true);
    setError(null);
  }, [isOpen, parentDurationSeconds]);

  const durationSeconds = durationMin * 60 + durationSec;
  const startAtRemainingSeconds = remainMin * 60 + remainSec;

  const preview = useMemo(() => {
    const draft = {
      label,
      durationSeconds,
      startMode,
      startAtRemainingSeconds,
      autoStart,
      displayMode,
    };
    const duration = clampQaDurationSeconds(durationSeconds, parentDurationSeconds || durationSeconds);
    const at = resolveQaStartAtRemaining(draft, parentDurationSeconds || duration);
    const parentLabel =
      parentDurationSeconds > 0 ? formatClockFromSeconds(parentDurationSeconds) : 'unknown length';
    const intoCue =
      parentDurationSeconds > 0 ? Math.max(0, parentDurationSeconds - at) : null;
    const flashSummary =
      startMode === 'end'
        ? `Flash “${label.trim() || 'Q&A'}” on Clock / DSM while the last ${formatClockFromSeconds(duration)} of this ${parentLabel} cue runs.`
        : `When ${formatClockFromSeconds(at)} remain on the cue, flash “${label.trim() || 'Q&A'}” on Clock / DSM (no sub-timer).`;
    const subSummary =
      startMode === 'end'
        ? `Q&A runs the last ${formatClockFromSeconds(duration)} of this ${parentLabel} cue.`
        : `When ${formatClockFromSeconds(at)} remain on the cue, start a ${formatClockFromSeconds(duration)} Q&A timer.`;
    return {
      duration,
      at,
      parentLabel,
      intoCue,
      summary: displayMode === 'flash' ? flashSummary : subSummary,
    };
  }, [
    label,
    durationSeconds,
    startMode,
    startAtRemainingSeconds,
    autoStart,
    displayMode,
    parentDurationSeconds,
  ]);

  if (!isOpen) return null;

  const submit = () => {
    const duration = clampQaDurationSeconds(durationSeconds, parentDurationSeconds || durationSeconds);
    if (duration < 1) {
      setError('Q&A duration must be at least 1 second.');
      return;
    }
    if (startMode === 'remaining' && startAtRemainingSeconds < duration) {
      setError('“When remaining” must be at least as long as the Q&A duration.');
      return;
    }
    if (parentDurationSeconds > 0 && startMode === 'remaining' && startAtRemainingSeconds > parentDurationSeconds) {
      setError('Remaining trigger cannot be longer than the parent cue.');
      return;
    }
    onConfirm({
      label: label.trim() || 'Q&A',
      durationSeconds: duration,
      startMode,
      startAtRemainingSeconds: resolveQaStartAtRemaining(
        {
          label,
          durationSeconds: duration,
          startMode,
          startAtRemainingSeconds,
          autoStart,
          displayMode,
        },
        parentDurationSeconds || duration
      ),
      autoStart,
      displayMode,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qa-plan-title"
    >
      <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close" onClick={onClose} />
      <div className="relative flex w-full max-w-lg max-h-[min(85vh,640px)] flex-col overflow-hidden rounded-2xl border border-amber-700/40 bg-slate-900 shadow-2xl">
        <div className="shrink-0 border-b border-slate-700 px-5 py-3 sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-300">Q&A plan</p>
          <h2 id="qa-plan-title" className="mt-1 text-lg font-semibold text-white sm:text-xl">
            Plan Q&A for “{parentSegmentName || 'this cue'}”
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Parent length: {preview.parentLabel}. Choose a sub timer under this cue, or a flash reminder on displays.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">Mode</legend>
            <div className="mt-2 space-y-2">
              <label className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-3">
                <input
                  type="radio"
                  name="qaDisplayMode"
                  checked={displayMode === 'sub'}
                  onChange={() => setDisplayMode('sub')}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-white">Sub timer</span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    Adds an indented Q&A timer row and “Q&A Timer” badge on displays.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-3">
                <input
                  type="radio"
                  name="qaDisplayMode"
                  checked={displayMode === 'flash'}
                  onChange={() => setDisplayMode('flash')}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-white">Flash reminder</span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    No sub-timer row — flashes Q&A on Clock / DSM while the parent cue runs past the threshold.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
              placeholder="Q&A"
            />
          </label>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {displayMode === 'flash' ? 'Q&A window length' : 'Q&A length'}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={durationMin}
                onChange={(e) => setDurationMin(Math.max(0, Number(e.target.value) || 0))}
                className="w-20 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
              />
              <span className="text-sm text-slate-400">min</span>
              <input
                type="number"
                min={0}
                max={59}
                value={durationSec}
                onChange={(e) => setDurationSec(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
                className="w-20 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
              />
              <span className="text-sm text-slate-400">sec</span>
            </div>
          </div>

          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {displayMode === 'flash' ? 'When should flashing start?' : 'When should Q&A start?'}
            </legend>
            <div className="mt-2 space-y-2">
              <label className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-3">
                <input
                  type="radio"
                  name="qaStartMode"
                  checked={startMode === 'end'}
                  onChange={() => setStartMode('end')}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-white">Last part of the cue</span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    Example: 40:00 cue + 10:00 Q&A → starts when 10:00 remain.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/50 px-3 py-3">
                <input
                  type="radio"
                  name="qaStartMode"
                  checked={startMode === 'remaining'}
                  onChange={() => setStartMode('remaining')}
                  className="mt-1"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">When remaining reaches</span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    Example: start when 20:00 remain on the parent.
                  </span>
                  {startMode === 'remaining' ? (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        value={remainMin}
                        onChange={(e) => setRemainMin(Math.max(0, Number(e.target.value) || 0))}
                        className="w-20 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
                      />
                      <span className="text-sm text-slate-400">min</span>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={remainSec}
                        onChange={(e) =>
                          setRemainSec(Math.max(0, Math.min(59, Number(e.target.value) || 0)))
                        }
                        className="w-20 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none"
                      />
                      <span className="text-sm text-slate-400">sec remaining</span>
                    </div>
                  ) : null}
                </span>
              </label>
            </div>
          </fieldset>

          <label className="flex items-center gap-2.5 rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-3">
            <input
              type="checkbox"
              checked={autoStart}
              onChange={(e) => setAutoStart(e.target.checked)}
            />
            <span className="text-sm text-slate-200">
              {displayMode === 'flash'
                ? 'Auto-flash when the parent cue hits that remaining time'
                : 'Auto-start this Q&A timer when the parent cue hits that remaining time'}
            </span>
          </label>

          <div className="rounded-xl border border-amber-700/40 bg-amber-950/25 px-3.5 py-3 text-sm text-amber-50/90 leading-relaxed">
            {preview.summary}
            {preview.intoCue != null ? (
              <span className="mt-1 block text-xs text-amber-200/70">
                Starts about {formatClockFromSeconds(preview.intoCue)} into the parent cue.
              </span>
            ) : null}
          </div>

          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-700 px-5 py-3 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-500"
          >
            {displayMode === 'flash' ? 'Save flash reminder' : 'Create Q&A timer'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QaPlanModal;
