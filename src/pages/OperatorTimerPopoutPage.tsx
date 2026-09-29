import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import OperatorCountdownModal from '../components/OperatorCountdownModal';
import {
  mapOperatorCountdownRow,
  OperatorCountdownDisplay,
} from '../lib/operatorCountdown';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';

/**
 * Small external control window for Op Timer (opened from Run of Show).
 * Syncs via REST poll + WebSocket; uses the same session token as the main app.
 */
const OperatorTimerPopoutPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId') || '';
  const userId = searchParams.get('userId') || undefined;
  const userName = searchParams.get('userName') || undefined;
  const userRole = searchParams.get('userRole') || undefined;

  const [liveCountdown, setLiveCountdown] = useState<OperatorCountdownDisplay | null>(null);
  const connectedRef = useRef(false);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    const applyRow = (row: any) => {
      if (cancelled) return;
      setLiveCountdown(mapOperatorCountdownRow(row));
    };

    const load = async () => {
      const row = await DatabaseService.getOperatorCountdown(eventId);
      applyRow(row);
    };

    void load();
    const pollId = window.setInterval(() => void load(), 2000);

    const callbacks = {
      onOperatorCountdownUpdated: (data: any) => {
        if (data?.event_id != null && String(data.event_id) !== String(eventId)) return;
        applyRow(data);
      },
      onOperatorCountdownCleared: (data: any) => {
        if (data?.event_id != null && String(data.event_id) !== String(eventId)) return;
        setLiveCountdown(null);
      },
      onConnectionChange: (connected: boolean) => {
        if (connected) void load();
      },
    };

    socketClient.connect(eventId, callbacks, 'opTimerPopout');
    connectedRef.current = true;

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      if (connectedRef.current) {
        socketClient.disconnect(eventId, 'opTimerPopout');
        connectedRef.current = false;
      }
    };
  }, [eventId]);

  if (!eventId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-300">
        Missing eventId — open this window from Run of Show → Operator Actions.
      </div>
    );
  }

  return (
    <OperatorCountdownModal
      isOpen
      variant="standalone"
      eventId={eventId}
      userId={userId}
      userName={userName || undefined}
      userRole={userRole}
      liveCountdown={liveCountdown}
      onClose={() => window.close()}
      onStarted={() => {
        /* live state via onLiveRow / WS */
      }}
      onCleared={() => setLiveCountdown(null)}
      onLiveRow={(mapped) => setLiveCountdown(mapped)}
    />
  );
};

export default OperatorTimerPopoutPage;
