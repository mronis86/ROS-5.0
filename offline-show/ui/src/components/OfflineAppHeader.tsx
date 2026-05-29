import React from 'react';
import { getOfflineDisplayName } from '../services/offline-user';

/** Visual match to main AppHeader — offline uses display name instead of sign-in. */
const OfflineAppHeader: React.FC = () => {
  const displayName = getOfflineDisplayName();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-slate-800 border-b border-slate-700 px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">R</span>
            </div>
            <h1 className="text-xl font-bold text-white">Run of Show</h1>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-white font-semibold text-base">{displayName}</p>
            <p className="text-slate-300 text-xs">Offline show · LAN</p>
          </div>
        </div>
      </div>
    </header>
  );
};

export default OfflineAppHeader;
