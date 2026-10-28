import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { RefreshNotice } from '../lib/appSettings';
import { ROS_APP_VERSION } from '../lib/rosVersion';
import { isBehindRefreshNotice, subscribeRefreshNotice } from '../lib/rosVersionPoll';

const SKIP_PATHS = new Set([
  '/admin',
  '/led-output',
  '/ultritouch-health',
  '/ultritouch-health-monitor',
  '/ultritouch-health-2u',
  '/ultritouch-health-2',
  '/stream-guide',
]);

/**
 * Shown only after Admin pushes a refresh notice — not on every Cloudflare deploy.
 * Clock / Green Room / Director stay on the current bundle until the operator clicks Refresh.
 */
const NewVersionBanner: React.FC = () => {
  const location = useLocation();
  const [notice, setNotice] = useState<RefreshNotice | null>(null);

  useEffect(() => subscribeRefreshNotice(setNotice), []);

  if (!notice || SKIP_PATHS.has(location.pathname) || !isBehindRefreshNotice(notice)) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[230] flex justify-center px-3 pt-3">
      <div className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-xl border border-amber-500/60 bg-slate-900/95 px-4 py-2.5 shadow-2xl backdrop-blur">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-200">Please refresh ROS</p>
          <p className="text-xs text-slate-400">
            Admin asked everyone to load {notice.version}. This tab is {ROS_APP_VERSION}. Live clocks
            are not reloaded automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-amber-400"
        >
          Refresh
        </button>
      </div>
    </div>
  );
};

export default NewVersionBanner;
