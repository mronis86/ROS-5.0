import { useEffect, useState } from 'react';
import {
  QA_FLASH_PULSE_MS,
  formatQaFlashCountdownLine,
  isQaFlashPulsing,
} from '../lib/qaPlan';

/**
 * Q&A flash on stage clocks: replace the countdown with "Q&A - MM:SS",
 * pulse the full line for 30s, then keep the prefix until Q&A ends.
 */
export function useQaFlashTimerLine(opts: {
  active: boolean;
  label?: string | null;
}) {
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [, setPulseEnded] = useState(0);

  useEffect(() => {
    if (opts.active) {
      setStartedAtMs((prev) => prev ?? Date.now());
    } else {
      setStartedAtMs(null);
    }
  }, [opts.active]);

  useEffect(() => {
    if (!opts.active || startedAtMs == null) return;
    const left = QA_FLASH_PULSE_MS - (Date.now() - startedAtMs);
    if (left <= 0) return;
    const t = window.setTimeout(() => setPulseEnded((n) => n + 1), left + 16);
    return () => window.clearTimeout(t);
  }, [opts.active, startedAtMs]);

  const show = !!opts.active;
  const pulsing = show && isQaFlashPulsing(startedAtMs);
  const label = String(opts.label || 'Q&A').trim() || 'Q&A';

  return {
    show,
    pulsing,
    label,
    timerClass: pulsing ? 'ros-qa-flash-timer' : '',
    formatLine: (timeBody: string) => formatQaFlashCountdownLine(label, timeBody),
  };
}
