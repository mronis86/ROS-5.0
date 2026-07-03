import { useCallback, useEffect, useRef, useState } from 'react';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';

/** Follow the loaded / running cue for graphics output pages. */
export function useActiveCueFollow(eventId: string | null | undefined) {
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [timerState, setTimerState] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const lastLoadedRef = useRef<number | null>(null);

  const applyTimer = useCallback((itemId: number, state: string) => {
    if (state === 'loaded' || state === 'running') {
      setActiveItemId(itemId);
      setTimerState(state);
      lastLoadedRef.current = itemId;
      return;
    }
    if (state === 'stopped') {
      setActiveItemId(null);
      setTimerState(null);
      lastLoadedRef.current = null;
    }
  }, []);

  const loadActiveTimer = useCallback(async () => {
    if (!eventId) return;
    try {
      const activeTimer = await DatabaseService.getActiveTimer(eventId);
      if (
        activeTimer &&
        activeTimer.is_active !== false &&
        activeTimer.timer_state !== 'stopped' &&
        (activeTimer.timer_state === 'loaded' || activeTimer.timer_state === 'running')
      ) {
        applyTimer(parseInt(String(activeTimer.item_id)), activeTimer.timer_state);
      } else {
        setActiveItemId(null);
        setTimerState(null);
        lastLoadedRef.current = null;
      }
    } catch (error) {
      console.error('useActiveCueFollow: failed to load active timer', error);
    } finally {
      setHasHydrated(true);
    }
  }, [eventId, applyTimer]);

  useEffect(() => {
    if (!eventId) {
      setHasHydrated(false);
      return;
    }

    setHasHydrated(false);
    setActiveItemId(null);
    setTimerState(null);
    lastLoadedRef.current = null;

    loadActiveTimer();

    const callbacks = {
      onTimerUpdated: (data: { item_id?: unknown; timer_state?: string }) => {
        if (!data?.item_id || !data.timer_state) return;
        applyTimer(parseInt(String(data.item_id)), data.timer_state);
      },
      onActiveTimersUpdated: (data: { item_id?: unknown; timer_state?: string }) => {
        if (!data?.item_id || !data.timer_state) return;
        applyTimer(parseInt(String(data.item_id)), data.timer_state);
      },
      onTimerStopped: () => {
        setActiveItemId(null);
        setTimerState(null);
        lastLoadedRef.current = null;
      },
      onTimersStopped: () => {
        setActiveItemId(null);
        setTimerState(null);
        lastLoadedRef.current = null;
      },
    };

    socketClient.connect(eventId, callbacks);
    return () => socketClient.disconnect(eventId);
  }, [eventId, loadActiveTimer, applyTimer]);

  const isCueActive =
    activeItemId != null && (timerState === 'loaded' || timerState === 'running');

  return { activeItemId, timerState, isCueActive, hasHydrated, reloadActiveTimer: loadActiveTimer };
}
