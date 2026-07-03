import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import LedCanvas from '../components/led/LedCanvas';
import LedFreeformRenderer from '../components/led/LedFreeformRenderer';
import { useActiveCueFollow } from '../hooks/useActiveCueFollow';
import { useLedOutputDisplay } from '../hooks/useLedOutputDisplay';
import {
  getLedOutputAnimatorStyle,
  parseLedOutputFromSettings,
  DEFAULT_LED_OUTPUT_ANIMATION,
} from '../lib/ledOutputAnimation';
import {
  DEFAULT_LED_OUTPUT_CLOCK,
  parseLedClockFromSettings,
  shouldShowLedClock,
} from '../lib/ledClock';
import type { LedOutputClock } from '../types/ledClock';
import LedClockOverlay from '../components/led/LedClockOverlay';
import { useLedOutputTimer } from '../hooks/useLedOutputTimer';
import type { LedOutputAnimation } from '../types/ledOutput';
import {
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
  const [outputAnimation, setOutputAnimation] = useState<LedOutputAnimation>(
    DEFAULT_LED_OUTPUT_ANIMATION
  );
  const [outputClock, setOutputClock] = useState<LedOutputClock>(DEFAULT_LED_OUTPUT_CLOCK);
  const [manualClearNonce, setManualClearNonce] = useState(0);

  const scheduleRef = useRef(schedule);
  const pendingScheduleRef = useRef<LedScheduleItem[] | null>(null);
  const isCueActiveRef = useRef(false);
  const outputAnimationRef = useRef(outputAnimation);
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
    outputAnimationRef.current = outputAnimation;
  }, [outputAnimation]);

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

  const { snapshot, phase, handleAnimationEnd } = useLedOutputDisplay({
    isCueActive,
    activeItemId,
    getScheduleItems,
    animation: outputAnimation,
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
        const nextAnimation = parseLedOutputFromSettings(data.settings);
        outputAnimationRef.current = nextAnimation;
        if (!isCueActiveRef.current) {
          setOutputAnimation(nextAnimation);
        }
        const nextClock = parseLedClockFromSettings(data.settings);
        outputClockRef.current = nextClock;
        setOutputClock(nextClock);
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
        setOutputAnimation(parseLedOutputFromSettings(data.settings));
        setOutputClock(parseLedClockFromSettings(data.settings));
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

  const animator = getLedOutputAnimatorStyle(phase, outputAnimation);
  const showGraphic = snapshot != null && animator.visible;
  const showClock = shouldShowLedClock(outputClock, showGraphic);

  if (!eventId) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-transparent text-white/50 text-sm">
        Add ?eventId=… to the URL
      </div>
    );
  }

  return (
    <div className="led-output-surface fixed inset-0 z-0">
      <LedCanvas>
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
