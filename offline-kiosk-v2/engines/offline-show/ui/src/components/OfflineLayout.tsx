import React from 'react';
import OfflineConnectivityBar from './OfflineConnectivityBar';
import ReconnectSyncOverlay from './ReconnectSyncOverlay';

type Props = { children: React.ReactNode };

/** Wraps offline UI pages with bottom connectivity bar and safe padding. */
const OfflineLayout: React.FC<Props> = ({ children }) => (
  <div className="offline-app">
    <main className="offline-main">{children}</main>
    <ReconnectSyncOverlay />
    <OfflineConnectivityBar />
  </div>
);

export default OfflineLayout;
