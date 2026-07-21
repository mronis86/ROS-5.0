import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParsedSpeaker } from '../showcase/photoShowcaseHelpers';
import type { LedLayoutConfig } from '../types/ledText';
import type { LedOutputAnimation, LedOutputPhase } from '../types/ledOutput';
import { DEFAULT_LED_OUTPUT_ANIMATION } from '../lib/ledOutputAnimation';
import {
  findScheduleItemById,
  getLedLayoutFromItem,
  getSpeakerForLayoutSlot,
  layoutHasVisibleContent,
  resolveLedTitle,
  type LedScheduleItem,
} from '../lib/ledText';

export type DisplaySnapshot = {
  layout: LedLayoutConfig;
  title: string;
  speakersBySlot: Map<number, ParsedSpeaker | null>;
};

export function buildSnapshot(
  items: LedScheduleItem[],
  activeItemId: number
): DisplaySnapshot | null {
  const item = findScheduleItemById(items, activeItemId);
  if (!item) return null;

  const layout = getLedLayoutFromItem(item);
  if (!layoutHasVisibleContent(layout)) return null;

  const speakersBySlot = new Map(
    [1, 2, 3, 4, 5, 6, 7].map((slot) => [
      slot,
      getSpeakerForLayoutSlot(item.speakersText, slot),
    ])
  );

  return {
    layout,
    title: resolveLedTitle(item, layout),
    speakersBySlot,
  };
}

type UseLedOutputDisplayArgs = {
  isCueActive: boolean;
  activeItemId: number | null;
  getScheduleItems: () => LedScheduleItem[];
  animation: LedOutputAnimation;
  manualClearNonce?: number;
  /** When true, hide any cue that was already loaded when the page opened (refresh). */
  suppressBootCue?: boolean;
  /** Bump when schedule contents change so snapshots rebuild (e.g. prerender load). */
  contentRevision?: number;
  /**
   * Prerender bake: no wall-clock timers. Caller drives enter progress via seekBakeMs
   * so capture can grab every frame at the correct CSS animation time.
   */
  bakeSeekMode?: boolean;
};

function waitAnimationFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let left = Math.max(1, count);
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function pauseAndSeekLedAnimations(enterMs: number) {
  const root =
    document.querySelector('[data-led-output-root]') ||
    document.querySelector('[data-led-canvas]') ||
    document.body;
  const anims =
    typeof (root as Element).getAnimations === 'function'
      ? (root as Element).getAnimations({ subtree: true })
      : document.getAnimations();
  for (const anim of anims) {
    try {
      anim.pause();
      anim.currentTime = Math.max(0, enterMs);
    } catch {
      /* ignore unfinished / non-CSS animations */
    }
  }
}

export function useLedOutputDisplay({
  isCueActive,
  activeItemId,
  getScheduleItems,
  animation,
  manualClearNonce = 0,
  suppressBootCue = false,
  contentRevision = 0,
  bakeSeekMode = false,
}: UseLedOutputDisplayArgs) {
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [phase, setPhase] = useState<LedOutputPhase>('idle');
  const phaseRef = useRef<LedOutputPhase>('idle');
  const lastCueIdRef = useRef<number | null>(null);
  const animationRef = useRef(animation);
  const activeItemIdRef = useRef(activeItemId);
  const suppressedRef = useRef(false);
  const suppressedCueIdRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const bootCueCapturedRef = useRef(false);
  const bakeSeekModeRef = useRef(bakeSeekMode);
  const getScheduleItemsRef = useRef(getScheduleItems);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    animationRef.current = animation;
  }, [animation]);

  useEffect(() => {
    activeItemIdRef.current = activeItemId;
  }, [activeItemId]);

  useEffect(() => {
    bakeSeekModeRef.current = bakeSeekMode;
  }, [bakeSeekMode]);

  useEffect(() => {
    getScheduleItemsRef.current = getScheduleItems;
  }, [getScheduleItems]);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const finishExit = useCallback(() => {
    clearHoldTimer();
    setSnapshot(null);
    setPhase('idle');
    lastCueIdRef.current = null;
  }, [clearHoldTimer]);

  const startEnter = useCallback((nextSnapshot: DisplaySnapshot, anim: LedOutputAnimation) => {
    setSnapshot(nextSnapshot);
    if (anim.style === 'none' || anim.inDurationMs === 0) {
      setPhase('visible');
      return;
    }
    setPhase('enter');
  }, []);

  const beginExit = useCallback(
    (anim: LedOutputAnimation) => {
      clearHoldTimer();
      if (anim.style === 'none' || anim.outDurationMs === 0) {
        finishExit();
        return;
      }
      setPhase('exit');
    },
    [finishExit, clearHoldTimer]
  );

  const runManualClear = useCallback(() => {
    const currentPhase = phaseRef.current;
    if (currentPhase === 'idle' || currentPhase === 'exit') {
      suppressedRef.current = true;
      suppressedCueIdRef.current = activeItemIdRef.current;
      return;
    }

    suppressedRef.current = true;
    suppressedCueIdRef.current = activeItemIdRef.current;
    clearHoldTimer();

    if (currentPhase === 'hold-in') {
      finishExit();
      return;
    }

    const anim = animationRef.current;
    if (anim.outDelayMs > 0) {
      setPhase('hold-out');
      holdTimerRef.current = window.setTimeout(() => beginExit(anim), anim.outDelayMs);
      return;
    }

    beginExit(anim);
  }, [beginExit, clearHoldTimer, finishExit]);

  // On refresh, do not auto-show a cue that was already loaded before this page opened.
  useEffect(() => {
    if (!suppressBootCue) {
      bootCueCapturedRef.current = false;
      return;
    }
    if (bootCueCapturedRef.current) return;

    bootCueCapturedRef.current = true;
    if (isCueActive && activeItemId != null) {
      suppressedRef.current = true;
      suppressedCueIdRef.current = activeItemId;
    }
  }, [suppressBootCue, isCueActive, activeItemId]);

  // Manual clear from layouts page — hide output while cue may stay loaded/running
  useEffect(() => {
    if (manualClearNonce === 0) return;
    runManualClear();
  }, [manualClearNonce, runManualClear]);

  // Cue unloaded — allow the next load to show output again
  useEffect(() => {
    if (!isCueActive && activeItemId == null) {
      suppressedRef.current = false;
      suppressedCueIdRef.current = null;
    }
  }, [isCueActive, activeItemId]);

  // Cue became inactive — hold (optional) then exit
  useEffect(() => {
    if (bakeSeekMode) return;
    if (isCueActive && activeItemId != null) return;

    const currentPhase = phaseRef.current;
    if (currentPhase === 'idle' || currentPhase === 'exit') return;

    if (currentPhase === 'hold-in') {
      finishExit();
      return;
    }

    if (currentPhase === 'hold-out') {
      return;
    }

    const anim = animationRef.current;
    if (anim.outDelayMs > 0) {
      setPhase('hold-out');
      holdTimerRef.current = window.setTimeout(() => beginExit(anim), anim.outDelayMs);
      return () => {
        clearHoldTimer();
      };
    }

    beginExit(anim);
  }, [isCueActive, activeItemId, beginExit, finishExit, clearHoldTimer, bakeSeekMode]);

  // Cue became active — build snapshot, hold (optional) then enter
  useEffect(() => {
    if (!isCueActive || activeItemId == null) return;

    const currentPhase = phaseRef.current;
    if (currentPhase === 'exit' || currentPhase === 'hold-out') {
      return;
    }

    if (
      suppressedRef.current &&
      suppressedCueIdRef.current != null &&
      suppressedCueIdRef.current === activeItemId
    ) {
      return;
    }

    if (
      suppressedRef.current &&
      suppressedCueIdRef.current != null &&
      suppressedCueIdRef.current !== activeItemId
    ) {
      suppressedRef.current = false;
      suppressedCueIdRef.current = null;
    }

    const items = getScheduleItems();
    if (!items.length) return;

    const nextSnapshot = buildSnapshot(items, activeItemId);
    if (!nextSnapshot) {
      finishExit();
      return;
    }

    const isNewCue = lastCueIdRef.current !== activeItemId;
    const anim = animationRef.current;

    // Bake seek: park once; external seekBakeMs drives progress (no timers).
    if (bakeSeekMode) {
      if (
        !isNewCue &&
        (currentPhase === 'hold-in' || currentPhase === 'enter' || currentPhase === 'visible')
      ) {
        return;
      }
      lastCueIdRef.current = activeItemId;
      clearHoldTimer();
      setSnapshot(nextSnapshot);
      if (anim.style === 'none' || anim.inDurationMs === 0) {
        setPhase(anim.inDelayMs > 0 ? 'hold-in' : 'visible');
      } else {
        setPhase('hold-in');
      }
      return;
    }

    if (!isNewCue && (currentPhase === 'visible' || currentPhase === 'enter')) {
      return;
    }

    lastCueIdRef.current = activeItemId;

    if (anim.inDelayMs > 0) {
      setSnapshot(nextSnapshot);
      setPhase('hold-in');
      holdTimerRef.current = window.setTimeout(() => startEnter(nextSnapshot, anim), anim.inDelayMs);
      return () => {
        clearHoldTimer();
      };
    }

    startEnter(nextSnapshot, anim);
  }, [
    isCueActive,
    activeItemId,
    getScheduleItems,
    contentRevision,
    finishExit,
    startEnter,
    clearHoldTimer,
    bakeSeekMode,
  ]);

  useEffect(() => () => clearHoldTimer(), [clearHoldTimer]);

  const handleAnimationEnd = useCallback(() => {
    if (bakeSeekModeRef.current) return;
    if (phaseRef.current === 'enter') {
      setPhase('visible');
      return;
    }
    if (phaseRef.current === 'exit') {
      finishExit();
    }
  }, [finishExit]);

  /** Absolute time into enter sequence: 0 = start of in-delay. */
  const seekBakeMs = useCallback(async (ms: number) => {
    if (!bakeSeekModeRef.current) return;
    const id = activeItemIdRef.current;
    if (id == null) return;

    const items = getScheduleItemsRef.current();
    const nextSnapshot = buildSnapshot(items, id);
    if (!nextSnapshot) return;

    const anim = animationRef.current;
    const delay = Math.max(0, anim.inDelayMs || 0);
    const dur = Math.max(0, anim.inDurationMs || 0);
    const t = Math.max(0, Number(ms) || 0);

    lastCueIdRef.current = id;
    setSnapshot(nextSnapshot);

    if (anim.style === 'none' || dur === 0) {
      setPhase(t < delay ? 'hold-in' : 'visible');
      await waitAnimationFrames(2);
      return;
    }

    if (t < delay) {
      setPhase('hold-in');
      await waitAnimationFrames(2);
      return;
    }

    const enterMs = t - delay;
    if (enterMs >= dur) {
      setPhase('visible');
      await waitAnimationFrames(2);
      return;
    }

    setPhase('enter');
    await waitAnimationFrames(2);
    pauseAndSeekLedAnimations(enterMs);
    await waitAnimationFrames(1);
  }, []);

  return { snapshot, phase, handleAnimationEnd, seekBakeMs };
}

export { DEFAULT_LED_OUTPUT_ANIMATION };
