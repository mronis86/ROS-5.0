import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

      if (data.settings) {
        const nextClock = parseLedClockFromSettings(data.settings);
        outputClockRef.current = nextClock;
        setOutputClock(nextClock);
        setOutputBackground(parseLedOutputBackgroundFromSettings(data.settings));
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
    [readLocalSchedule]
  );

  const loadSchedule = useCallback(async () => {
    if (!eventId) return;
    try {
      const localItems = readLocalSchedule();
      const data = await DatabaseService.getRunOfShowData(eventId, { bypassCache: true });
      const apiItems = parseScheduleItems(data?.schedule_items);
      const merged = mergeLedScheduleItems(apiItems, localItems);
      const items = merged.length ? merged : localItems;
      if (!items.length) return;

      pendingScheduleRef.current = items;
      setSchedule(items);
      if (data?.settings) {
        setOutputClock(parseLedClockFromSettings(data.settings));
        setOutputBackground(parseLedOutputBackgroundFromSettings(data.settings));
      }
    } catch (error) {
      console.error('LedOutputPage: failed to load schedule', error);
      const localItems = readLocalSchedule();
      if (!localItems.length) return;
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

  if (!eventId) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-transparent text-white/50 text-sm">
        Add ?eventId=… to the URL
      </div>
    );
  }

  return (
    <div className="led-output-surface fixed inset-0 z-0">
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
