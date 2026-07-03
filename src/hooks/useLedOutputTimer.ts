import { useCallback, useEffect, useRef, useState } from 'react';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';

export type LedTimerSnapshot = {
  itemId: number | null;
  isRunning: boolean;
  isLoaded: boolean;
  remainingSeconds: number | null;
  durationSeconds: number;
};

type TimerRow = {
  item_id?: unknown;
  timer_state?: string;
  is_active?: boolean;
  is_running?: boolean;
  started_at?: string;
  duration_seconds?: number;
};

function snapshotFromRow(row: TimerRow | null): LedTimerSnapshot | null {
  if (
    !row ||
    row.is_active === false ||
    row.timer_state === 'stopped' ||
    (row.timer_state !== 'loaded' && row.timer_state !== 'running')
  ) {
    return null;
  }

  const duration = row.duration_seconds ?? 0;
  let remaining: number | null = null;

  if (row.is_running && row.started_at) {
    const startedMs = new Date(row.started_at).getTime();
    if (Number.isFinite(startedMs)) {
      remaining = duration - (Date.now() - startedMs) / 1000;
    }
  } else if (row.timer_state === 'loaded') {
    remaining = duration;
  }

  return {
    itemId: row.item_id != null ? parseInt(String(row.item_id), 10) : null,
    isRunning: !!row.is_running,
    isLoaded: true,
    remainingSeconds: remaining,
    durationSeconds: duration,
  };
}

export function useLedOutputTimer(eventId: string | null | undefined) {
  const [timer, setTimer] = useState<LedTimerSnapshot | null>(null);
  const rowRef = useRef<TimerRow | null>(null);

  const syncFromRow = useCallback(() => {
    setTimer(snapshotFromRow(rowRef.current));
  }, []);

  const applyRow = useCallback(
    (row: TimerRow | null) => {
      rowRef.current = row;
      syncFromRow();
    },
    [syncFromRow]
  );

  useEffect(() => {
    if (!eventId) {
      applyRow(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const active = await DatabaseService.getActiveTimer(eventId);
        if (!cancelled) applyRow(active);
      } catch (error) {
        console.error('useLedOutputTimer: failed to load active timer', error);
      }
    };

    load();

    const callbacks = {
      onTimerUpdated: (data: TimerRow) => {
        if (!data) return;
        applyRow(data);
      },
      onActiveTimersUpdated: (data: TimerRow) => {
        if (!data) return;
        applyRow(data);
      },
      onTimerStarted: (data: TimerRow) => {
        if (!data) return;
        applyRow(data);
      },
      onTimerStopped: () => applyRow(null),
      onTimersStopped: () => applyRow(null),
    };

    socketClient.connect(eventId, callbacks);

    return () => {
      cancelled = true;
    };
  }, [eventId, applyRow]);

  useEffect(() => {
    const id = window.setInterval(syncFromRow, 250);
    return () => window.clearInterval(id);
  }, [syncFromRow]);

  return timer;
}
