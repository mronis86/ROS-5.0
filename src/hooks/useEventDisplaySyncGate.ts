import { useCallback, useEffect, useRef, useState } from 'react';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';

type Options = {
  /** When false, do not connect socket for display-sync updates (optional pages). */
  listenSocket?: boolean;
};

/**
 * Tracks whether admin has enabled follower sync for this event.
 * When false, follower pages should stop HTTP polling and disconnect WebSocket.
 */
export function useEventDisplaySyncGate(eventId: string | undefined, options: Options = {}) {
  const { listenSocket = true } = options;
  const displaySyncEnabledRef = useRef(true);
  const [displaySyncPaused, setDisplaySyncPaused] = useState(false);
  const [displaySyncChecked, setDisplaySyncChecked] = useState(false);

  const applyDisplaySyncEnabled = useCallback(
    (enabled: boolean, opts?: { disconnect?: boolean }) => {
      displaySyncEnabledRef.current = enabled;
      setDisplaySyncPaused(!enabled);
      setDisplaySyncChecked(true);
      if (!enabled && opts?.disconnect !== false && eventId) {
        socketClient.disconnect(eventId);
      }
    },
    [eventId]
  );

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    let intervalId: number | null = null;
    displaySyncEnabledRef.current = true;
    setDisplaySyncPaused(false);
    setDisplaySyncChecked(false);

    const ACTIVE_POLL_MS = 20_000;
    // When paused, tabs only need a slow resume check — 20s looks like kill-list spam.
    const PAUSED_POLL_MS = 90_000;
    // Background Chrome tabs still run timers; don't keep pinging Railway while hidden.
    const HIDDEN_POLL_MS = 120_000;

    const pollMs = (enabled: boolean) => {
      if (typeof document !== 'undefined' && document.hidden) return HIDDEN_POLL_MS;
      return enabled ? ACTIVE_POLL_MS : PAUSED_POLL_MS;
    };

    const schedule = (enabled: boolean) => {
      if (intervalId != null) window.clearInterval(intervalId);
      intervalId = window.setInterval(() => {
        void load();
      }, pollMs(enabled));
    };

    const load = async () => {
      try {
        const enabled = await DatabaseService.getDisplaySyncEnabled(eventId);
        if (cancelled) return;
        applyDisplaySyncEnabled(enabled, { disconnect: !enabled });
        schedule(enabled);
      } catch {
        /* keep previous */
      }
    };
    void load();
    schedule(true);

    const onVisibility = () => {
      // Immediate check when the operator focuses the tab again (e.g. after Admin Resume).
      if (!document.hidden) void load();
      else schedule(displaySyncEnabledRef.current);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (intervalId != null) window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [eventId, applyDisplaySyncEnabled]);

  useEffect(() => {
    if (!eventId || !listenSocket) return;

    const onUpdate = (message: { type?: string; data?: { event_id?: string; displaySyncEnabled?: boolean } }) => {
      if (message?.type !== 'displaySyncUpdate') return;
      const data = message.data;
      if (!data || data.event_id !== eventId) return;
      if (typeof data.displaySyncEnabled !== 'boolean') return;
      applyDisplaySyncEnabled(data.displaySyncEnabled);
    };

    const attach = () => {
      const socket = socketClient.getSocket();
      if (!socket) return;
      socket.on('update', onUpdate);
    };

    attach();
    const retry = window.setInterval(() => {
      const socket = socketClient.getSocket();
      if (socket?.connected) {
        attach();
        window.clearInterval(retry);
      }
    }, 1000);

    return () => {
      window.clearInterval(retry);
      socketClient.getSocket()?.off('update', onUpdate);
    };
  }, [eventId, listenSocket, applyDisplaySyncEnabled]);

  const followerSyncAllowed = useCallback(() => {
    return displaySyncEnabledRef.current;
  }, []);

  return {
    displaySyncEnabledRef,
    displaySyncPaused,
    displaySyncChecked,
    followerSyncAllowed,
    applyDisplaySyncEnabled,
  };
}
