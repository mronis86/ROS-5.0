import { useCallback, useEffect, useRef, useState } from 'react';
import type { LedOutputAnimation, LedOutputPhase } from '../types/ledOutput';

type PreviewMode = 'in' | 'out' | 'cycle' | null;

const CYCLE_DWELL_MS = 900;

export function useLedAnimationPreview(animation: LedOutputAnimation) {
  const [phase, setPhase] = useState<LedOutputPhase>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const phaseRef = useRef<LedOutputPhase>('idle');
  const modeRef = useRef<PreviewMode>(null);
  const timersRef = useRef<number[]>([]);
  const animationRef = useRef(animation);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    animationRef.current = animation;
  }, [animation]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  const stop = useCallback(() => {
    clearTimers();
    modeRef.current = null;
    setIsPlaying(false);
    setPhase('idle');
  }, [clearTimers]);

  const finishEnter = useCallback(() => {
    setPhase('visible');
    if (modeRef.current === 'cycle') {
      schedule(() => startExitSequence(), CYCLE_DWELL_MS);
    } else {
      modeRef.current = null;
      setIsPlaying(false);
    }
  }, [schedule]);

  const finishExit = useCallback(() => {
    setPhase('idle');
    modeRef.current = null;
    setIsPlaying(false);
  }, []);

  const startExitSequence = useCallback(() => {
    const anim = animationRef.current;
    if (anim.style === 'none' || anim.outDurationMs === 0) {
      finishExit();
      return;
    }
    if (anim.outDelayMs > 0) {
      setPhase('hold-out');
      schedule(() => setPhase('exit'), anim.outDelayMs);
    } else {
      setPhase('exit');
    }
  }, [finishExit, schedule]);

  const startEnterSequence = useCallback(() => {
    const anim = animationRef.current;
    if (anim.style === 'none') {
      setPhase('visible');
      if (modeRef.current === 'cycle') {
        schedule(() => startExitSequence(), CYCLE_DWELL_MS);
      } else {
        modeRef.current = null;
        setIsPlaying(false);
      }
      return;
    }
    if (anim.inDelayMs > 0) {
      setPhase('hold-in');
      schedule(() => {
        if (anim.inDurationMs === 0) finishEnter();
        else setPhase('enter');
      }, anim.inDelayMs);
    } else if (anim.inDurationMs === 0) {
      finishEnter();
    } else {
      setPhase('enter');
    }
  }, [finishEnter, schedule, startExitSequence]);

  const previewIn = useCallback(() => {
    clearTimers();
    modeRef.current = 'in';
    setIsPlaying(true);
    setPhase('idle');
    startEnterSequence();
  }, [clearTimers, startEnterSequence]);

  const previewOut = useCallback(() => {
    clearTimers();
    modeRef.current = 'out';
    setIsPlaying(true);
    setPhase('visible');
    startExitSequence();
  }, [clearTimers, startExitSequence]);

  const previewCycle = useCallback(() => {
    clearTimers();
    modeRef.current = 'cycle';
    setIsPlaying(true);
    setPhase('idle');
    startEnterSequence();
  }, [clearTimers, startEnterSequence]);

  const handleAnimationEnd = useCallback(() => {
    if (phaseRef.current === 'enter') finishEnter();
    if (phaseRef.current === 'exit') finishExit();
  }, [finishEnter, finishExit]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return {
    phase,
    isPlaying,
    previewIn,
    previewOut,
    previewCycle,
    stop,
    handleAnimationEnd,
  };
}
