import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAppHeaderCollapse } from '../contexts/AppHeaderCollapseContext';
import { useLiveSyncStatus } from '../contexts/LiveSyncStatusContext';
import { useNarrowViewport } from '../hooks/useNarrowViewport';
import {
  getShowLiveSyncStatusBadge,
  SHOW_LIVE_SYNC_STATUS_BADGE_CHANGE_EVENT,
} from '../lib/branding';
import UserProfile from './UserProfile';
import AppLogo from './AppLogo';
import AppBrandTitle from './AppBrandTitle';

function mobileDisplayName(user: { full_name?: string | null; email?: string | null }): string {
  const raw = (user.full_name || user.email || '').trim();
  if (!raw) return 'User';
  return user.full_name || raw.split('@')[0];
}

function mobileDisplayEmail(user: { email?: string | null }): string | null {
  const email = (user.email || '').trim();
  return email || null;
}

const AppHeader: React.FC = () => {
  const { user, signOut } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const isNarrow = useNarrowViewport();
  const { collapsed, isRunOfShowPage } = useAppHeaderCollapse();
  const hiddenOnRunOfShow = isRunOfShowPage && collapsed;
  const liveSync = useLiveSyncStatus();
  const [showLiveSyncBadge, setShowLiveSyncBadge] = useState(() => getShowLiveSyncStatusBadge());

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ showLiveSyncStatusBadge?: boolean }>).detail;
      if (typeof detail?.showLiveSyncStatusBadge === 'boolean') {
        setShowLiveSyncBadge(detail.showLiveSyncStatusBadge);
      } else {
        setShowLiveSyncBadge(getShowLiveSyncStatusBadge());
      }
    };
    window.addEventListener(SHOW_LIVE_SYNC_STATUS_BADGE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(SHOW_LIVE_SYNC_STATUS_BADGE_CHANGE_EVENT, onChange);
  }, []);

  const handleSignOut = () => {
    if (confirm('Are you sure you want to sign out?')) {
      signOut();
    }
  };

  const selfInPresence = liveSync.selfInPresence;
  const liveOk = liveSync.connected === true && selfInPresence;
  const liveBad =
    liveSync.connected === false || (liveSync.connected === true && !selfInPresence);
  const showBadge = showLiveSyncBadge && liveSync.active;

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 h-[var(--app-header-height)] box-border bg-slate-800 border-b border-slate-700 transition-transform duration-200 ease-out ${
        isNarrow ? 'px-3' : 'px-5'
      } ${hiddenOnRunOfShow ? '-translate-y-full pointer-events-none opacity-0' : ''}`}
      aria-hidden={hiddenOnRunOfShow}
    >
      <div className="flex h-full min-w-0 items-center justify-between gap-2 sm:gap-4">
        <div className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2">
          <AppLogo size="sm" />
          <AppBrandTitle
            titleClassName="truncate text-sm font-bold text-white leading-none sm:text-base"
            taglineClassName="text-[10px] uppercase tracking-[0.04em] text-slate-400 leading-none -mt-0.5"
            showTagline={!isNarrow}
          />
          {showBadge ? (
            <button
              type="button"
              onClick={() => {
                if (liveBad) {
                  liveSync.openAlert?.();
                }
              }}
              className={`ml-1 flex shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium transition-colors sm:text-xs ${
                liveOk
                  ? 'border-emerald-600 bg-emerald-800/80 text-emerald-50 hover:bg-emerald-700'
                  : liveBad
                    ? 'border-amber-500 bg-amber-800/90 text-amber-50 hover:bg-amber-700'
                    : 'border-slate-500 bg-slate-600 text-slate-200'
              }`}
              title={
                liveOk
                  ? 'Live sync connected — you appear in event presence'
                  : liveBad
                    ? 'Live sync / presence issue — click for help'
                    : 'Connecting to live sync…'
              }
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  liveOk
                    ? 'bg-emerald-300'
                    : liveBad
                      ? 'bg-amber-300 animate-pulse'
                      : 'bg-slate-400 animate-pulse'
                }`}
              />
              {liveOk ? 'Live' : liveBad ? 'Sync issue' : 'Connecting'}
            </button>
          ) : null}
        </div>

        {user ? (
          isNarrow ? (
            <div className="flex min-w-0 max-w-[52%] shrink-0 items-center gap-2">
              <div className="min-w-0 flex-1 text-right leading-tight">
                <p
                  className="truncate text-xs font-semibold text-white"
                  title={user.full_name || user.email || ''}
                >
                  {mobileDisplayName(user)}
                </p>
                {mobileDisplayEmail(user) ? (
                  <p className="truncate text-[10px] text-slate-400" title={user.email || ''}>
                    {mobileDisplayEmail(user)}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="flex shrink-0 flex-col items-center justify-center rounded-md bg-red-600 px-2.5 py-1 text-white transition-colors hover:bg-red-500 active:bg-red-700"
                title="Sign out"
                aria-label="Sign out"
              >
                <svg className="h-3.5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.75 9V5.25A2.25 2.25 0 0112 3h7.5a2.25 2.25 0 012.25 2.25v13.5A2.25 2.25 0 0119.5 21h-7.5a2.25 2.25 0 01-2.25-2.25V15M6.75 12H3m0 0l3-3m-3 3l3 3"
                  />
                </svg>
                <span className="mt-0.5 text-[8px] font-semibold leading-none tracking-tight">Sign Out</span>
              </button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-4">
              <div className="text-right">
                <p className="text-base font-semibold text-white">{user.full_name || user.email}</p>
                <p className="text-xs text-slate-300">{user.email}</p>
              </div>

              <button
                onClick={handleSignOut}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-500"
                title="Sign out"
              >
                Sign Out
              </button>
            </div>
          )
        ) : (
          <div className="shrink-0 text-xs text-slate-400 sm:text-sm">Please sign in to continue</div>
        )}

        {showProfile && (
          <div className="absolute right-6 top-[var(--app-header-height)] z-50">
            <UserProfile onClose={() => setShowProfile(false)} />
          </div>
        )}
      </div>
    </header>
  );
};

export default AppHeader;
