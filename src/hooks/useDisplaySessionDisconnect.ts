import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readPersistedDisplaySession,
  writePersistedDisplaySession,
} from '../lib/creativeDisplaySession';
import {
  DISPLAY_SESSION_MAX_HOURS,
  DISPLAY_SESSION_PICK_TIME_ALERT,
} from '../lib/displaySession';
import { socketClient } from '../services/socket-client';

export type UseDisplaySessionDisconnectOptions = {
  /** When false, the hook is inert (no modal, connection stays enabled). */
  enabled?: boolean;
  eventId?: string | null;
  /** Disconnect the event websocket when the timer expires (default: true when eventId is set). */
  disconnectSocket?: boolean;
  /** When set, timer state is shared across pages via localStorage (e.g. Creative ROS + Review). */
  persistSessionKey?: string | null;
  /** Called when the session timer expires, after connection is marked inactive. */
  onSessionEnd?: () => void;
  /** Called when the user clicks Reconnect. */
  onReconnect?: () => void;
};

function formatDurationLabel(hours: number, minutes: number): string {
  let timeText = '';
  if (hours > 0) timeText += `${hours}h `;
  if (minutes > 0) timeText += `${minutes}m`;
  return timeText.trim();
}

export function useDisplaySessionDisconnect({
  enabled = true,
  eventId = null,
  disconnectSocket,
  persistSessionKey = null,
  onSessionEnd,
  onReconnect,
}: UseDisplaySessionDisconnectOptions = {}) {
  const shouldDisconnectSocket = disconnectSocket ?? Boolean(eventId);
  const connectionEnabledRef = useRef(true);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSessionEndRef = useRef(onSessionEnd);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showDisconnectNotification, setShowDisconnectNotification] = useState(false);
  const [disconnectDuration, setDisconnectDuration] = useState('');
  const [hasShownModalOnce, setHasShownModalOnce] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);
  const hydratedPersistKeyRef = useRef<string | null>(null);

  onSessionEndRef.current = onSessionEnd;

  const endSession = useCallback(
    (durationLabel: string) => {
      connectionEnabledRef.current = false;
      setDisconnectDuration(durationLabel);
      setShowDisconnectNotification(true);
      onSessionEndRef.current?.();

      if (persistSessionKey) {
        writePersistedDisplaySession(persistSessionKey, {
          expiresAt: 0,
          disconnected: true,
          durationLabel,
        });
      }

      if (shouldDisconnectSocket && eventId) {
        setTimeout(() => {
          socketClient.disconnect(eventId);
        }, 100);
      }
    },
    [eventId, persistSessionKey, shouldDisconnectSocket]
  );

  const scheduleSessionEnd = useCallback(
    (ms: number, durationLabel: string) => {
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      connectionEnabledRef.current = true;
      setShowDisconnectNotification(false);

      if (persistSessionKey) {
        writePersistedDisplaySession(persistSessionKey, {
          expiresAt: Date.now() + ms,
          disconnected: false,
          durationLabel,
        });
      }

      disconnectTimerRef.current = setTimeout(() => {
        endSession(durationLabel);
      }, ms);
    },
    [endSession, persistSessionKey]
  );

  useEffect(() => {
    if (!enabled || !persistSessionKey) return;
    if (hydratedPersistKeyRef.current === persistSessionKey) return;
    hydratedPersistKeyRef.current = persistSessionKey;

    const stored = readPersistedDisplaySession(persistSessionKey);
    setHasShownModalOnce(true);

    if (!stored) {
      setShowDisconnectModal(true);
      return;
    }

    if (stored.disconnected) {
      connectionEnabledRef.current = false;
      setDisconnectDuration(stored.durationLabel);
      setShowDisconnectNotification(true);
      return;
    }

    const remaining = stored.expiresAt - Date.now();
    if (remaining > 0) {
      scheduleSessionEnd(remaining, stored.durationLabel);
      return;
    }

    endSession(stored.durationLabel || 'session');
  }, [enabled, persistSessionKey, endSession, scheduleSessionEnd]);

  useEffect(() => {
    if (!enabled) return;
    if (persistSessionKey) return;
    if (!hasShownModalOnce && connectionEnabledRef.current) {
      setShowDisconnectModal(true);
      setHasShownModalOnce(true);
    }
  }, [enabled, hasShownModalOnce, persistSessionKey]);

  useEffect(() => {
    return () => {
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
    };
  }, []);

  const handleDisconnectTimerConfirm = useCallback(
    (hours: number, minutes: number) => {
      const totalMinutes = hours * 60 + minutes;
      if (totalMinutes === 0) {
        alert(DISPLAY_SESSION_PICK_TIME_ALERT);
        return;
      }

      const durationLabel = formatDurationLabel(hours, minutes);
      const ms = totalMinutes * 60 * 1000;
      scheduleSessionEnd(ms, durationLabel);
      setShowDisconnectModal(false);

      if (eventId && shouldDisconnectSocket && !socketClient.isConnected()) {
        setReconnectKey((k) => k + 1);
      }
    },
    [eventId, scheduleSessionEnd, shouldDisconnectSocket]
  );

  const handleNeverDisconnect = useCallback(() => {
    handleDisconnectTimerConfirm(DISPLAY_SESSION_MAX_HOURS, 0);
  }, [handleDisconnectTimerConfirm]);

  const handleReconnect = useCallback(() => {
    connectionEnabledRef.current = true;
    setShowDisconnectNotification(false);
    if (persistSessionKey) {
      writePersistedDisplaySession(persistSessionKey, null);
    }
    setReconnectKey((k) => k + 1);
    setShowDisconnectModal(true);
    onReconnect?.();
  }, [onReconnect, persistSessionKey]);

  return {
    connectionEnabledRef,
    reconnectKey,
    sessionDisconnected: showDisconnectNotification,
    showDisconnectModal: enabled && showDisconnectModal,
    showDisconnectNotification: enabled && showDisconnectNotification,
    disconnectDuration,
    handleDisconnectTimerConfirm,
    handleNeverDisconnect,
    handleReconnect,
  };
}
