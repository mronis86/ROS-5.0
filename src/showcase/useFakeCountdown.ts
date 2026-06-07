import { useSyncExternalStore } from 'react';

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Shared epoch so every showcase mock reads the same second tick. */
const showcaseEpochMs = Date.now();
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | undefined;
let alignTimeoutId: ReturnType<typeof setTimeout> | undefined;

function getElapsedSec(): number {
  return Math.floor((Date.now() - showcaseEpochMs) / 1000);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (listeners.size === 1) {
    const msUntilTick = 1000 - (Date.now() % 1000);
    alignTimeoutId = setTimeout(() => {
      listeners.forEach((l) => l());
      intervalId = setInterval(() => listeners.forEach((l) => l()), 1000);
    }, msUntilTick);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      if (alignTimeoutId) clearTimeout(alignTimeoutId);
      if (intervalId) clearInterval(intervalId);
      alignTimeoutId = intervalId = undefined;
    }
  };
}

/** Aligned second tick — shared by countdown and follow-mode mocks. */
export function subscribeShowcaseTick(cb: () => void): () => void {
  return subscribe(cb);
}

export function getShowcaseElapsedSec(): number {
  return getElapsedSec();
}

/** Derive remaining seconds from the shared showcase clock (loops at zero). */
export function getSyncedRemaining(initialRemainingSec: number, running = true): number {
  if (!running || initialRemainingSec < 0) return Math.max(0, initialRemainingSec);
  const elapsed = getElapsedSec();
  const period = initialRemainingSec + 1;
  return initialRemainingSec - (elapsed % period);
}

/**
 * Ticking countdown for showcase mockups — all instances share one aligned second tick.
 */
export function useFakeCountdown(initialRemainingSec: number, running = true): number {
  const elapsed = useSyncExternalStore(subscribe, getElapsedSec, () => 0);
  void elapsed;
  return getSyncedRemaining(initialRemainingSec, running);
}
