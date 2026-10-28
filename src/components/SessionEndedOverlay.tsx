import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import AuthModal from './AuthModal';

/**
 * Shown when the API token dies (401) but React still has a user.
 * Keeps the current page mounted so a mid-show refresh is not forced.
 */
const SessionEndedOverlay: React.FC = () => {
  const { sessionExpired, user } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  if (!sessionExpired || !user) return null;

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      {showAuth ? (
        <AuthModal isOpen onClose={() => setShowAuth(false)} onSuccess={() => setShowAuth(false)} />
      ) : (
        <div className="w-full max-w-md rounded-2xl border border-slate-600 bg-slate-800 p-6 shadow-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-400">Session ended</p>
          <h2 className="mt-2 text-xl font-bold text-white">You were signed out</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">
            This tab is still open so you do not lose what you were looking at. Sign in again to keep
            saving and syncing. We will not refresh the page for you.
          </p>
          {user.email ? (
            <p className="mt-3 truncate text-xs text-slate-400">Last signed in as {user.email}</p>
          ) : null}
          <button
            type="button"
            onClick={() => setShowAuth(true)}
            className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Sign in
          </button>
        </div>
      )}
    </div>
  );
};

export default SessionEndedOverlay;
