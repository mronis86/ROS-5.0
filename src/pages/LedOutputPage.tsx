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

const LedOutputPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId');
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

  const { activeItemId, isCueActive, hasHydrated } = useActiveCueFollow(eventId);
  const liveTimer = useLedOutputTimer(eventId);

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
    return getCueOutputAnimation(getLedLayoutFromItem(item));
  }, [activeItemId, schedule]);

  const { snapshot, phase, handleAnimationEnd } = useLedOutputDisplay({
    isCueActive,
    activeItemId,
    getScheduleItems,
    animation: resolvedAnimation,
    manualClearNonce,
    suppressBootCue: hasHydrated,
  });

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
    if (!eventId) return;
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
  }, [eventId, applyRosData, triggerManualClear]);

  useEffect(() => {
    if (!eventId) return;
    return subscribeLedOutputClear(eventId, triggerManualClear);
  }, [eventId, triggerManualClear]);

  useEffect(() => {
    if (isCueActive || !pendingScheduleRef.current) return;
    setSchedule(pendingScheduleRef.current);
  }, [isCueActive]);

  const animator = getLedOutputAnimatorStyle(phase, resolvedAnimation);
  const showGraphic = snapshot != null && animator.visible;
  const showClock = shouldShowLedClock(outputClock, showGraphic);
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
