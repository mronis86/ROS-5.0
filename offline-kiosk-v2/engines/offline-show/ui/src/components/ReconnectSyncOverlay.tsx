import React, { useEffect, useState } from 'react';
import {
  subscribeReconnectOverlay,
  type ReconnectOverlayState,
} from '../services/offline-sync-bridge';

const ReconnectSyncOverlay: React.FC = () => {
  const [state, setState] = useState<ReconnectOverlayState>({ active: false, message: '' });

  useEffect(() => subscribeReconnectOverlay(setState), []);

  if (!state.active) return null;

  return (
    <div className="offline-cloud-sync-overlay" role="alertdialog" aria-modal="true" aria-busy="true">
      <div className="offline-cloud-sync-overlay__panel">
        <div className="offline-cloud-sync-overlay__spinner" aria-hidden />
        <h2 className="offline-cloud-sync-overlay__title">Pausing — syncing to cloud</h2>
        <p className="offline-cloud-sync-overlay__message">{state.message}</p>
        <p className="offline-cloud-sync-overlay__hint">
          Your offline Run of Show is being sent to the hosted app. The page will not reload from cloud.
        </p>
      </div>
    </div>
  );
};

export default ReconnectSyncOverlay;
