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

/** Brand purple → blue → green gradient for Pre Show Countdown (static / stage-friendly). */
export const RAINBOW_COUNTDOWN_GRADIENT =
  'linear-gradient(90deg, #8b5cf6 0%, #6366f1 40%, #3b82f6 70%, #10b981 100%)';

/** @deprecated Prefer `.ros-rainbow-text` / `.ros-rainbow-fill` CSS; kept for ROS inline fallbacks. */
export function rainbowCountdownColor(_nowMs: number = Date.now()): string {
  return RAINBOW_COUNTDOWN_GRADIENT;
}

/** Drive re-renders while a rainbow countdown is active (only needed if not using CSS animation). */
export function useRainbowCountdownTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

/**
 * Status color from remaining seconds (same 120s / 30s thresholds as Clock).
 * Primary (>120s) follows Admin countdown color mode.
 * When `rainbow` is true, returns the rainbow gradient string (use for bar backgrounds;
 * prefer `.ros-rainbow-text` for digit color).
 */
export function countdownColorForRemaining(
  remainingSeconds: number,
  opts?: {
    isRunning?: boolean;
    mode?: CountdownColorModeId;
    rainbow?: boolean;
    nowMs?: number;
  }
): string {
  if (opts?.isRunning === false) return COUNTDOWN_IDLE_COLOR;
  if (opts?.rainbow) return RAINBOW_COUNTDOWN_GRADIENT;
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
