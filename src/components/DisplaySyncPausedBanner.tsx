import React from 'react';
import { DISPLAY_SYNC_PAUSED_MESSAGE } from '../lib/displaySync';

const DisplaySyncPausedBanner: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    className={`fixed inset-x-0 top-0 z-[999998] bg-amber-950/95 border-b border-amber-600/60 px-4 py-3 text-center ${className}`}
    role="status"
  >
    <p className="text-amber-100 text-sm sm:text-base font-medium">{DISPLAY_SYNC_PAUSED_MESSAGE}</p>
  </div>
);

export default DisplaySyncPausedBanner;
