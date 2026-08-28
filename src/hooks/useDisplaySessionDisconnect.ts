import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Called when the session timer expires, after connection is marked inactive. */
  onSessionEnd?: () => void;
  /** Called when the user clicks Reconnect. */
  onReconnect?: () => void;
};

export function useDisplaySessionDisconnect({
  enabled = true,
  eventId = null,
  disconnectSocket,
  onSessionEnd,
  onReconnect,
}: UseDisplaySessionDisconnectOptions = {}) {
  const shouldDisconnectSocket = disconnectSocket ?? Boolean(eventId);
  const connectionEnabledRef = useRef(true);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showDisconnectNotification, setShowDisconnectNotification] = useState(false);
  const [disconnectDuration, setDisconnectDuration] = useState('');
  const [hasShownModalOnce, setHasShownModalOnce] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (!hasShownModalOnce && connectionEnabledRef.current) {
      setShowDisconnectModal(true);
      setHasShownModalOnce(true);
    }
  }, [enabled, hasShownModalOnce]);

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

      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      connectionEnabledRef.current = true;

      const ms = totalMinutes * 60 * 1000;
      disconnectTimerRef.current = setTimeout(() => {
        let timeText = '';
        if (hours > 0) timeText += `${hours}h `;
        if (minutes > 0) timeText += `${minutes}m`;

        connectionEnabledRef.current = false;
        setDisconnectDuration(timeText.trim());
        setShowDisconnectNotification(true);
        onSessionEnd?.();

        if (shouldDisconnectSocket && eventId) {
          setTimeout(() => {
            socketClient.disconnect(eventId);
          }, 100);
        }
      }, ms);

      setShowDisconnectModal(false);

      if (eventId && shouldDisconnectSocket && !socketClient.isConnected()) {
        setReconnectKey((k) => k + 1);
      }
    },
    [eventId, onSessionEnd, shouldDisconnectSocket]
  );

  const handleNeverDisconnect = useCallback(() => {
    handleDisconnectTimerConfirm(DISPLAY_SESSION_MAX_HOURS, 0);
  }, [handleDisconnectTimerConfirm]);

  const handleReconnect = useCallback(() => {
    connectionEnabledRef.current = true;
    setShowDisconnectNotification(false);
    setReconnectKey((k) => k + 1);
    setShowDisconnectModal(true);
    onReconnect?.();
  }, [onReconnect]);

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
