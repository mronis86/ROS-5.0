import { useCallback, useEffect, useRef, useState } from 'react';
import { socketClient } from '../services/socket-client';
import {
  pptClockFeedHasVisual,
  readPptClockAuto,
  writePptClockAuto,
  type PptClockFeed,
} from '../lib/pptClockFeed';

type PublishInput = Omit<PptClockFeed, 'enabled' | 'auto'>;

export function usePptClockPublisher(
  eventId: string,
  feed: PublishInput,
  canAuto: boolean
) {
  const [clockFeedActive, setClockFeedActive] = useState(false);
  const [autoPush, setAutoPush] = useState(false);
  const clockFeedActiveRef = useRef(false);
  const autoPushRef = useRef(false);
  const suppressItemIdRef = useRef<number | null>(null);
  const lastKeyRef = useRef('');

  useEffect(() => {
    setAutoPush(readPptClockAuto(eventId));
  }, [eventId]);

  useEffect(() => {
    clockFeedActiveRef.current = clockFeedActive;
  }, [clockFeedActive]);

  useEffect(() => {
    autoPushRef.current = autoPush;
  }, [autoPush]);

  const emitOn = useCallback(() => {
    if (!eventId || !pptClockFeedHasVisual(feed)) return;
    socketClient.emitPptClock({
      enabled: true,
      imageUrl: feed.imageUrl || '',
      liveCaptureUrl: feed.liveCaptureUrl || '',
      liveCaptureActive: !!feed.liveCaptureActive,
      slideIndex: feed.slideIndex ?? null,
      deckName: feed.deckName || '',
      itemId: feed.itemId ?? null,
      auto: autoPushRef.current,
    });
    setClockFeedActive(true);
  }, [eventId, feed]);

  const emitOff = useCallback(() => {
    if (!eventId) return;
    socketClient.emitPptClock({ enabled: false });
    setClockFeedActive(false);
  }, [eventId]);

  const pushToClock = useCallback(() => {
    suppressItemIdRef.current = null;
    emitOn();
  }, [emitOn]);

  const clearClock = useCallback(() => {
    if (feed.itemId != null) suppressItemIdRef.current = feed.itemId;
    emitOff();
  }, [emitOff, feed.itemId]);

  const setAutoPushPref = useCallback(
    (on: boolean) => {
      writePptClockAuto(eventId, on);
      setAutoPush(on);
      if (!on) return;
      suppressItemIdRef.current = null;
    },
    [eventId]
  );

  const feedKey = [
    feed.imageUrl || '',
    feed.liveCaptureUrl || '',
    feed.liveCaptureActive ? '1' : '0',
    feed.slideIndex ?? '',
    feed.itemId ?? '',
    canAuto ? '1' : '0',
    autoPush ? '1' : '0',
  ].join('|');

  useEffect(() => {
    if (!eventId) return;
    const itemId = feed.itemId ?? null;
    if (
      suppressItemIdRef.current != null &&
      itemId != null &&
      itemId !== suppressItemIdRef.current
    ) {
      suppressItemIdRef.current = null;
    }
    const suppressed =
      suppressItemIdRef.current != null && itemId === suppressItemIdRef.current;
    const hasVisual = pptClockFeedHasVisual(feed);
    const shouldAuto = autoPush && canAuto && hasVisual && !suppressed;

    if (shouldAuto) {
      if (lastKeyRef.current === feedKey && clockFeedActiveRef.current) return;
      lastKeyRef.current = feedKey;
      emitOn();
      return;
    }

    if (autoPush && clockFeedActiveRef.current && !canAuto && !suppressed) {
      lastKeyRef.current = '';
      emitOff();
      return;
    }

    if (!autoPush && clockFeedActiveRef.current && hasVisual) {
      if (lastKeyRef.current === feedKey) return;
      lastKeyRef.current = feedKey;
      emitOn();
      return;
    }

    if (!autoPush && clockFeedActiveRef.current && !hasVisual) {
      lastKeyRef.current = '';
      emitOff();
    }
  }, [autoPush, canAuto, emitOff, emitOn, eventId, feed, feedKey]);

  return {
    clockFeedActive,
    autoPush,
    setAutoPushPref,
    pushToClock,
    clearClock,
    canPush: pptClockFeedHasVisual(feed),
  };
}
