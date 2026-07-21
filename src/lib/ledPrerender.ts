import { buildLedOutputPageUrl } from './ledOutputBackground';
import type { LedOutputAnimation } from '../types/ledOutput';

/** DOM marker set when enter animation finished and the graphic is visible (bake can stop). */
export const LED_PRERENDER_READY_ATTR = 'data-led-prerender-ready';

/** Enter-only bake: keep cue in/out timing but force no exit during capture. */
export function enterOnlyLedPrerenderAnimation(anim: LedOutputAnimation): LedOutputAnimation {
  return {
    ...anim,
    outDurationMs: 0,
    outDelayMs: 0,
  };
}

export function isLedPrerenderMode(searchParams: URLSearchParams): boolean {
  const raw = searchParams.get('prerender');
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** Deterministic bake: seek CSS animation frame-by-frame (smooth WebM, not real-time capture). */
export function isLedBakeSeekMode(searchParams: URLSearchParams): boolean {
  if (!isLedPrerenderMode(searchParams)) return false;
  const raw = searchParams.get('bakeSeek');
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function parseLedPrerenderItemId(searchParams: URLSearchParams): number | null {
  const raw = searchParams.get('itemId') ?? searchParams.get('cueId');
  if (raw == null || raw === '') return null;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

/** Bake / capture URL for one cue (enter animation + settle). */
export function buildLedPrerenderCueUrl(eventId: string, itemId: number): string {
  const base = buildLedOutputPageUrl(eventId);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}prerender=1&bakeSeek=1&itemId=${encodeURIComponent(String(itemId))}&clock=0`;
}

export type LedBakeControl = {
  ready: boolean;
  getTiming: () => {
    inDelayMs: number;
    inMs: number;
    clipMs: number;
    style: string;
  };
  /** Show graphic at absolute ms into enter sequence (0 = start of in-delay). */
  seek: (ms: number) => Promise<void>;
};

declare global {
  interface Window {
    __ledBakeControl?: LedBakeControl;
  }
}
