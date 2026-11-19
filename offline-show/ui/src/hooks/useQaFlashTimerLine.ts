import { useEffect, useState } from 'react';
import {
  QA_FLASH_PULSE_MS,
  formatQaFlashCountdownLine,
  isQaFlashPulsing,
} from '../lib/qaPlan';

/**
 * Q&A flash on stage clocks:
 * - Arms while `active` (threshold crossed)
 * - Ends after `durationSeconds` (Q&A window), then returns to normal countdown
 * - Pulses for the first 30s
 */
export function useQaFlashTimerLine(opts: {
  active: boolean;
  label?: string | null;
  /** How long the flash stays on after arming; 0/omit = until `active` clears. */
  durationSeconds?: number | null;
}) {
  const [armedAtMs, setArmedAtMs] = useState<number | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (opts.active) {
      setArmedAtMs((prev) => prev ?? Date.now());
    } else {
      setArmedAtMs(null);
    }
  }, [opts.active]);

  const durationMs = Math.max(0, Math.floor(Number(opts.durationSeconds) || 0) * 1000);
  const withinDuration =
    armedAtMs == null
      ? false
      : durationMs <= 0
        ? true
        : Date.now() - armedAtMs < durationMs;

  const show = !!opts.active && armedAtMs != null && withinDuration;

  // Drop show when the Q&A window ends even if parent is still under threshold.
  useEffect(() => {
    if (!opts.active || armedAtMs == null || durationMs <= 0) return;
    const left = durationMs - (Date.now() - armedAtMs);
    if (left <= 0) {
      setTick((n) => n + 1);
      return;
    }
    const t = window.setTimeout(() => setTick((n) => n + 1), left + 16);
    return () => window.clearTimeout(t);
  }, [opts.active, armedAtMs, durationMs]);

  useEffect(() => {
    if (!show || armedAtMs == null) return;
    const left = QA_FLASH_PULSE_MS - (Date.now() - armedAtMs);
    if (left <= 0) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), left + 16);
    return () => window.clearTimeout(t);
  }, [show, armedAtMs]);

  const pulsing = show && isQaFlashPulsing(armedAtMs);
  const label = String(opts.label || 'Q&A').trim() || 'Q&A';

  return {
    show,
    pulsing,
    label,
    /** Purple pulse / steady classes for the flash cluster. */
    timerClass: pulsing ? 'ros-qa-flash-timer' : show ? 'ros-qa-flash-steady' : '',
    formatLine: (timeBody: string) => formatQaFlashCountdownLine(label, timeBody),
  };
}
