import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '../services/api-client';
import { apiJsonHeaders } from '../lib/sessionAuth';
import { socketClient } from '../services/socket-client';
import {
  pptClockFeedHasVisual,
  readPptClockAuto,
  writePptClockAuto,
  type PptClockFeed,
} from '../lib/pptClockFeed';

type PublishInput = Omit<PptClockFeed, 'enabled' | 'auto'>;

async function postClockSetting(
  eventId: string,
  path: 'clock-auto' | 'clock-clear',
  body: Record<string, unknown>
) {
  try {
    await fetch(
      `${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/playback/${path}`,
      {
        method: 'POST',
        headers: apiJsonHeaders(),
        body: JSON.stringify(body),
      }
    );
  } catch {
    /* socket + local UI still apply */
  }
}

export function usePptClockPublisher(
  eventId: string,
  feed: PublishInput,
  canAuto: boolean,
  serverAuto?: boolean | null
) {
  const [clockFeedActive, setClockFeedActive] = useState(false);
  const [autoPush, setAutoPush] = useState(() =>
    typeof serverAuto === 'boolean' ? serverAuto : readPptClockAuto(eventId)
  );
  const clockFeedActiveRef = useRef(false);
  const autoPushRef = useRef(false);
  const suppressItemIdRef = useRef<number | null>(null);
  const lastKeyRef = useRef('');

  useEffect(() => {
    if (typeof serverAuto === 'boolean') {
      setAutoPush(serverAuto);
      writePptClockAuto(eventId, serverAuto);
      return;
    }
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/playback`,
          { headers: apiJsonHeaders() }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (typeof data?.session?.clockAutoPush === 'boolean') {
          setAutoPush(data.session.clockAutoPush);
          writePptClockAuto(eventId, data.session.clockAutoPush);
        }
      } catch {
        if (!cancelled) setAutoPush(readPptClockAuto(eventId));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, serverAuto]);

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
    if (eventId) void postClockSetting(eventId, 'clock-clear', { itemId: feed.itemId ?? null });
    emitOff();
  }, [emitOff, eventId, feed.itemId]);

  const setAutoPushPref = useCallback(
    (on: boolean) => {
      writePptClockAuto(eventId, on);
      setAutoPush(on);
      if (eventId) void postClockSetting(eventId, 'clock-auto', { enabled: on });
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
