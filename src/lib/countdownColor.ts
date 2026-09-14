import { useEffect, useState } from 'react';
import {
  COUNTDOWN_COLOR_CHANGE_EVENT,
  getCountdownColorModeId,
  getCountdownPrimaryHex,
  type CountdownColorModeId,
} from './branding';

export {
  COUNTDOWN_COLOR_MODES,
  COUNTDOWN_COLOR_MODE_STORAGE_KEY,
  COUNTDOWN_COLOR_CHANGE_EVENT,
  getCountdownColorModeId,
  getCountdownPrimaryHex,
  applyCountdownColorModeId,
  parseCountdownColorModeId,
  type CountdownColorModeId,
} from './branding';

/** Idle / not-running countdown surfaces. */
export const COUNTDOWN_IDLE_COLOR = '#6b7280';
export const COUNTDOWN_WARN_COLOR = '#f59e0b';
export const COUNTDOWN_DANGER_COLOR = '#ef4444';

/**
 * Status color from remaining seconds (same 120s / 30s thresholds as Clock).
 * Primary (>120s) follows Admin countdown color mode.
 */
export function countdownColorForRemaining(
  remainingSeconds: number,
  opts?: { isRunning?: boolean; mode?: CountdownColorModeId }
): string {
  if (opts?.isRunning === false) return COUNTDOWN_IDLE_COLOR;
  if (remainingSeconds > 120) return getCountdownPrimaryHex(opts?.mode);
  if (remainingSeconds > 30) return COUNTDOWN_WARN_COLOR;
  return COUNTDOWN_DANGER_COLOR;
}

/** Subscribe so open Clock / timer pages update when Admin changes the mode. */
export function useCountdownColorMode(): CountdownColorModeId {
  const [mode, setMode] = useState<CountdownColorModeId>(() => getCountdownColorModeId());
  useEffect(() => {
    const onChange = () => setMode(getCountdownColorModeId());
    window.addEventListener(COUNTDOWN_COLOR_CHANGE_EVENT, onChange);
    window.addEventListener('ros:branding-change', onChange);
    return () => {
      window.removeEventListener(COUNTDOWN_COLOR_CHANGE_EVENT, onChange);
      window.removeEventListener('ros:branding-change', onChange);
    };
  }, []);
  return mode;
}
