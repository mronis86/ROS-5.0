import React, { useEffect, useMemo, useState } from 'react';
import {
  clampQaDurationSeconds,
  defaultQaPlanDraft,
  formatClockFromSeconds,
  resolveQaStartAtRemaining,
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
    };
    const duration = clampQaDurationSeconds(durationSeconds, parentDurationSeconds || durationSeconds);
    const at = resolveQaStartAtRemaining(draft, parentDurationSeconds || duration);
    const parentLabel =
      parentDurationSeconds > 0 ? formatClockFromSeconds(parentDurationSeconds) : 'unknown length';
    const intoCue =
      parentDurationSeconds > 0 ? Math.max(0, parentDurationSeconds - at) : null;
    return {
      duration,
      at,
      parentLabel,
      intoCue,
      summary:
        startMode === 'end'
          ? `Q&A runs the last ${formatClockFromSeconds(duration)} of this ${parentLabel} cue.`
          : `When ${formatClockFromSeconds(at)} remain on the cue, start a ${formatClockFromSeconds(duration)} Q&A ALT timer.`,
    };
  }, [
    label,
    durationSeconds,
    startMode,
    startAtRemainingSeconds,
    autoStart,
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
        },
        parentDurationSeconds || duration
      ),
      autoStart,
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
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-600 bg-slate-900 shadow-2xl">
        <div className="border-b border-slate-700 px-5 py-4 sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300">Q&A plan</p>
          <h2 id="qa-plan-title" className="mt-1 text-xl font-semibold text-white">
            Plan Q&A for “{parentSegmentName || 'this cue'}”
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Parent length: {preview.parentLabel}. Creates an indented ALT row and can auto-start it.
          </p>
        </div>

        <div className="space-y-4 px-5 py-5 sm:px-6">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              placeholder="Q&A"
            />
          </label>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Q&A duration</p>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={durationMin}
                onChange={(e) => setDurationMin(Math.max(0, Number(e.target.value) || 0))}
                className="w-20 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
              <span className="text-sm text-slate-400">min</span>
              <input
                type="number"
                min={0}
                max={59}
                value={durationSec}
                onChange={(e) => setDurationSec(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
                className="w-20 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
              <span className="text-sm text-slate-400">sec</span>
            </div>
          </div>

          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              When should Q&A start?
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
                  <span className="block text-sm font-semibold text-white">At the end of the cue</span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    Start when the last {formatClockFromSeconds(Math.max(1, durationSeconds))} begin
                    (e.g. 40:00 cue + 10:00 Q&A → starts at 10:00 remaining).
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
                    e.g. start a 10:00 Q&A when 20:00 remain on the parent.
                  </span>
                  {startMode === 'remaining' ? (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        value={remainMin}
                        onChange={(e) => setRemainMin(Math.max(0, Number(e.target.value) || 0))}
                        className="w-20 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
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
                        className="w-20 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
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
              Auto-start the Q&A ALT timer when the parent cue hits that remaining time
            </span>
          </label>

          <div className="rounded-xl border border-sky-700/40 bg-sky-950/25 px-3.5 py-3 text-sm text-sky-100/90 leading-relaxed">
            {preview.summary}
            {preview.intoCue != null ? (
              <span className="mt-1 block text-xs text-sky-200/70">
                Starts about {formatClockFromSeconds(preview.intoCue)} into the parent cue.
              </span>
            ) : null}
          </div>

          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-700 px-5 py-4 sm:px-6">
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
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
          >
            Create Q&A row
          </button>
        </div>
      </div>
    </div>
  );
};

export default QaPlanModal;
