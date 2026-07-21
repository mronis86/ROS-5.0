import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import LedCanvas from '../components/led/LedCanvas';
import LedFreeformRenderer from '../components/led/LedFreeformRenderer';
import { useActiveCueFollow } from '../hooks/useActiveCueFollow';
import { useLedOutputDisplay } from '../hooks/useLedOutputDisplay';
import {
  getLedOutputAnimatorStyle,
  DEFAULT_LED_OUTPUT_ANIMATION,
} from '../lib/ledOutputAnimation';
import {
  applyLedOutputPageChrome,
  parseLedOutputBackgroundFromSettings,
  resolveLedCanvasBackground,
} from '../lib/ledOutputBackground';
import {
  DEFAULT_LED_OUTPUT_CLOCK,
  parseLedClockFromSettings,
  shouldShowLedClock,
} from '../lib/ledClock';
import type { LedOutputClock } from '../types/ledClock';
import LedClockOverlay from '../components/led/LedClockOverlay';
import { useLedOutputTimer } from '../hooks/useLedOutputTimer';
import type { LedOutputBackground } from '../types/ledOutput';
import { DEFAULT_LED_OUTPUT_BACKGROUND } from '../types/ledOutput';
import {
  findScheduleItemById,
  getCueOutputAnimation,
  getLedLayoutFromItem,
  mergeLedScheduleItems,
  parseScheduleItems,
  type LedScheduleItem,
} from '../lib/ledText';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';
import { dispatchLedOutputClear, subscribeLedOutputClear } from '../lib/ledOutputClear';
import {
  hydrateLedEventSettingsFromLocal,
  ledEventSettingsFromRosSettings,
  subscribeLedEventSettings,
  writeLedEventSettingsToLocal,
} from '../lib/ledEventSettings';
import {
  LED_PRERENDER_READY_ATTR,
  enterOnlyLedPrerenderAnimation,
  isLedBakeSeekMode,
  isLedPrerenderMode,
  parseLedPrerenderItemId,
  type LedBakeControl,
} from '../lib/ledPrerender';

const LedOutputPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId');
  const prerenderMode = isLedPrerenderMode(searchParams);
  const bakeSeekMode = isLedBakeSeekMode(searchParams);
  const prerenderItemId = prerenderMode ? parseLedPrerenderItemId(searchParams) : null;
  const hideClock = searchParams.get('clock') === '0';
  const [schedule, setSchedule] = useState<LedScheduleItem[]>([]);
  const [outputClock, setOutputClock] = useState<LedOutputClock>(DEFAULT_LED_OUTPUT_CLOCK);
  const [outputBackground, setOutputBackground] = useState<LedOutputBackground>(
    DEFAULT_LED_OUTPUT_BACKGROUND
  );
  const [manualClearNonce, setManualClearNonce] = useState(0);

  const scheduleRef = useRef(schedule);
  const pendingScheduleRef = useRef<LedScheduleItem[] | null>(null);
  const isCueActiveRef = useRef(false);
  const outputClockRef = useRef(outputClock);

  const liveFollow = useActiveCueFollow(prerenderMode ? null : eventId);
  // Wait until schedule is loaded before activating prerender — otherwise
  // useLedOutputDisplay runs once with empty items and never retries.
  const prerenderItemInSchedule =
    prerenderItemId != null &&
    schedule.some((item) => Number(item.id) === Number(prerenderItemId));
  const activeItemId = prerenderMode
    ? prerenderItemInSchedule
      ? prerenderItemId
      : null
    : liveFollow.activeItemId;
  const isCueActive = prerenderMode
    ? prerenderItemInSchedule
    : liveFollow.isCueActive;
  const hasHydrated = prerenderMode ? true : liveFollow.hasHydrated;
  const liveTimer = useLedOutputTimer(prerenderMode ? null : eventId);

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  useEffect(() => {
    isCueActiveRef.current = isCueActive;
  }, [isCueActive]);

  useEffect(() => {
    outputClockRef.current = outputClock;
  }, [outputClock]);

  const getScheduleItems = useCallback(
    () => pendingScheduleRef.current ?? scheduleRef.current,
    []
  );

  const triggerManualClear = useCallback(() => {
    setManualClearNonce((n) => n + 1);
  }, []);

  const resolvedAnimation = useMemo(() => {
    if (activeItemId == null) return DEFAULT_LED_OUTPUT_ANIMATION;
    const item = findScheduleItemById(schedule, activeItemId);
    if (!item) return DEFAULT_LED_OUTPUT_ANIMATION;
    const anim = getCueOutputAnimation(getLedLayoutFromItem(item));
    // Bake/capture: play the real animate-in only (no exit).
    return prerenderMode ? enterOnlyLedPrerenderAnimation(anim) : anim;
  }, [activeItemId, prerenderMode, schedule]);

  const { snapshot, phase, handleAnimationEnd, seekBakeMs } = useLedOutputDisplay({
    isCueActive,
    activeItemId,
    getScheduleItems,
    animation: resolvedAnimation,
    manualClearNonce,
    suppressBootCue: prerenderMode ? false : hasHydrated,
    contentRevision: schedule.length,
    bakeSeekMode,
  });

  useEffect(() => {
    if (!bakeSeekMode) {
      document.documentElement.classList.remove('led-bake-seek');
      return;
    }
    document.documentElement.classList.add('led-bake-seek');
    return () => document.documentElement.classList.remove('led-bake-seek');
  }, [bakeSeekMode]);

  // Deterministic bake API for Spout bake-pack (seek CSS frames; not wall-clock capture).
  useEffect(() => {
    if (!prerenderMode || !bakeSeekMode) {
      delete window.__ledBakeControl;
      document.documentElement.removeAttribute('data-led-bake-control');
      return;
    }

    const control: LedBakeControl = {
      ready: Boolean(prerenderItemInSchedule && snapshot != null),
      getTiming: () => {
        const inDelayMs = resolvedAnimation.inDelayMs ?? 0;
        const inMs = resolvedAnimation.inDurationMs ?? 0;
        return {
          inDelayMs,
          inMs,
          clipMs: inDelayMs + inMs,
          style: resolvedAnimation.style,
        };
      },
      seek: (ms: number) => seekBakeMs(ms),
    };
    window.__ledBakeControl = control;
    document.documentElement.setAttribute(
      'data-led-bake-control',
      control.ready ? '1' : '0'
    );

    return () => {
      delete window.__ledBakeControl;
      document.documentElement.removeAttribute('data-led-bake-control');
    };
  }, [
    prerenderMode,
    bakeSeekMode,
    prerenderItemInSchedule,
    snapshot,
    resolvedAnimation.inDelayMs,
    resolvedAnimation.inDurationMs,
    resolvedAnimation.style,
    seekBakeMs,
  ]);

  // Bake script / Spout capture waits for this marker before grabbing frames.
  useEffect(() => {
    if (!prerenderMode) {
      document.documentElement.removeAttribute(LED_PRERENDER_READY_ATTR);
      document.documentElement.removeAttribute('data-led-prerender-error');
      return;
    }

    if (schedule.length > 0 && prerenderItemId != null && !prerenderItemInSchedule) {
      document.documentElement.removeAttribute(LED_PRERENDER_READY_ATTR);
      document.documentElement.setAttribute(
        'data-led-prerender-error',
        `itemId ${prerenderItemId} not in schedule`
      );
      return;
    }

    document.documentElement.removeAttribute('data-led-prerender-error');
    document.documentElement.setAttribute('data-led-prerender-phase', phase);
    document.documentElement.setAttribute(
      'data-led-prerender-in-ms',
      String(resolvedAnimation.inDurationMs ?? 0)
    );
    document.documentElement.setAttribute(
      'data-led-prerender-in-delay-ms',
      String(resolvedAnimation.inDelayMs ?? 0)
    );
    const clipMs =
      (resolvedAnimation.inDelayMs ?? 0) + (resolvedAnimation.inDurationMs ?? 0);
    document.documentElement.setAttribute('data-led-prerender-clip-ms', String(clipMs));

    // Bake-seek: ready to sample as soon as snapshot exists.
    // Legacy wall-clock bake: recording while enter sequence runs.
    const recording = bakeSeekMode
      ? Boolean(prerenderItemInSchedule && snapshot != null)
      : prerenderItemInSchedule &&
        snapshot != null &&
        (phase === 'hold-in' || phase === 'enter' || phase === 'visible');
    if (recording) {
      document.documentElement.setAttribute('data-led-prerender-recording', '1');
    } else {
      document.documentElement.removeAttribute('data-led-prerender-recording');
    }

    const ready =
      prerenderItemId != null &&
      prerenderItemInSchedule &&
      snapshot != null &&
      (bakeSeekMode || phase === 'visible');
    if (ready) {
      document.documentElement.setAttribute(LED_PRERENDER_READY_ATTR, '1');
    } else {
      document.documentElement.removeAttribute(LED_PRERENDER_READY_ATTR);
    }
    return () => {
      document.documentElement.removeAttribute(LED_PRERENDER_READY_ATTR);
      document.documentElement.removeAttribute('data-led-prerender-error');
      document.documentElement.removeAttribute('data-led-prerender-phase');
      document.documentElement.removeAttribute('data-led-prerender-in-ms');
      document.documentElement.removeAttribute('data-led-prerender-in-delay-ms');
      document.documentElement.removeAttribute('data-led-prerender-clip-ms');
      document.documentElement.removeAttribute('data-led-prerender-recording');
    };
  }, [
    prerenderMode,
    bakeSeekMode,
    prerenderItemId,
    prerenderItemInSchedule,
    schedule.length,
    snapshot,
    phase,
    resolvedAnimation.inDurationMs,
    resolvedAnimation.inDelayMs,
  ]);

  const readLocalSchedule = useCallback((): LedScheduleItem[] => {
    if (!eventId) return [];
    const saved = localStorage.getItem(`runOfShowSchedule_${eventId}`);
    return parseScheduleItems(saved);
  }, [eventId]);

  const applyRosData = useCallback(
    (data: { schedule_items?: unknown; settings?: Record<string, unknown> } | null) => {
      if (!data) return;

      if (data.settings && eventId) {
        const nextClock = parseLedClockFromSettings(data.settings);
        outputClockRef.current = nextClock;
        setOutputClock(nextClock);
        setOutputBackground(parseLedOutputBackgroundFromSettings(data.settings));
        writeLedEventSettingsToLocal(eventId, ledEventSettingsFromRosSettings(data.settings));
      }

      const apiItems = parseScheduleItems(data.schedule_items);
      if (!apiItems.length) return;

      const localItems = readLocalSchedule();
      const merged = mergeLedScheduleItems(apiItems, localItems);
      pendingScheduleRef.current = merged;

      if (!isCueActiveRef.current) {
        setSchedule(merged);
      }
    },
    [eventId, readLocalSchedule]
  );

  useEffect(() => {
    if (!eventId) return;
    return subscribeLedEventSettings(eventId, (settings) => {
      if (settings.ledOutputBackground) {
        setOutputBackground(settings.ledOutputBackground);
      }
      if (settings.ledClock) {
        outputClockRef.current = settings.ledClock;
        setOutputClock(settings.ledClock);
      }
    });
  }, [eventId]);

  const loadSchedule = useCallback(async () => {
    if (!eventId) return;

    const localSettings = hydrateLedEventSettingsFromLocal(eventId);
    if (localSettings?.ledOutputBackground) {
      setOutputBackground(localSettings.ledOutputBackground);
    }
    if (localSettings?.ledClock) {
      outputClockRef.current = localSettings.ledClock;
      setOutputClock(localSettings.ledClock);
    }

    try {
      const localItems = readLocalSchedule();
      const data = await DatabaseService.getRunOfShowData(eventId, { bypassCache: true });

      if (data?.settings) {
        setOutputClock(parseLedClockFromSettings(data.settings));
        setOutputBackground(parseLedOutputBackgroundFromSettings(data.settings));
        writeLedEventSettingsToLocal(eventId, ledEventSettingsFromRosSettings(data.settings));
      }

      const apiItems = parseScheduleItems(data?.schedule_items);
      const merged = mergeLedScheduleItems(apiItems, localItems);
      const items = merged.length ? merged : localItems;

      pendingScheduleRef.current = items;
      setSchedule(items);
    } catch (error) {
      console.error('LedOutputPage: failed to load schedule', error);
      const localItems = readLocalSchedule();
      pendingScheduleRef.current = localItems;
      setSchedule(localItems);
    }
  }, [eventId, readLocalSchedule]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    if (!eventId || prerenderMode) return;
    const callbacks = {
      onRunOfShowDataUpdated: (data: {
        schedule_items?: unknown;
        settings?: Record<string, unknown>;
      }) => {
        applyRosData(data);
      },
      onLedOutputClear: () => {
        triggerManualClear();
      },
    };
    socketClient.connect(eventId, callbacks);
    return () => socketClient.disconnect(eventId);
  }, [eventId, prerenderMode, applyRosData, triggerManualClear]);

  useEffect(() => {
    if (!eventId || prerenderMode) return;
    return subscribeLedOutputClear(eventId, triggerManualClear);
  }, [eventId, prerenderMode, triggerManualClear]);

  useEffect(() => {
    if (isCueActive || !pendingScheduleRef.current) return;
    setSchedule(pendingScheduleRef.current);
  }, [isCueActive]);

  const animator = getLedOutputAnimatorStyle(phase, resolvedAnimation);
  const showGraphic = snapshot != null && animator.visible;
  const showClock =
    !hideClock && !prerenderMode && shouldShowLedClock(outputClock, showGraphic);
  const canvasBackground = resolveLedCanvasBackground(outputBackground);

  // Override global slate-900 on html / body / #root / .App (see index.css).
  useLayoutEffect(() => applyLedOutputPageChrome(outputBackground), [outputBackground]);

  if (!eventId) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-transparent text-white/50 text-sm">
        Add ?eventId=… to the URL
      </div>
    );
  }

  return (
    <div
      data-led-output-root="1"
      className="led-output-surface fixed inset-0 z-0"
      style={{
        backgroundColor: canvasBackground,
        backgroundImage: 'none',
      }}
    >
      <LedCanvas backgroundColor={canvasBackground}>
        {showGraphic && snapshot ? (
          <div
            className={`w-full h-full led-editor-no-transition ${animator.className}`}
            style={animator.style}
            onAnimationEnd={handleAnimationEnd}
          >
            <LedFreeformRenderer
              layout={snapshot.layout}
              title={snapshot.title}
              speakersBySlot={snapshot.speakersBySlot}
            />
          </div>
        ) : null}
        {showClock ? <LedClockOverlay clock={outputClock} timer={liveTimer} /> : null}
      </LedCanvas>
    </div>
  );
};

export default LedOutputPage;
