import React from 'react';
import { getOfflineDisplayName } from '../services/offline-user';
import AppLogo from './AppLogo';
import AppBrandTitle from './AppBrandTitle';

/** Visual match to main AppHeader — offline uses display name instead of sign-in. */
const OfflineAppHeader: React.FC = () => {
  const displayName = getOfflineDisplayName();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-[var(--app-header-height)] box-border bg-slate-800 border-b border-slate-700 px-5">
      <div className="flex h-full items-center justify-between gap-4">
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-1.5">
            <AppLogo size="sm" />
            <AppBrandTitle
              titleClassName="text-base font-bold text-white leading-none"
              taglineClassName="text-[9px] uppercase tracking-[0.06em] text-slate-500 leading-none"
            />
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
