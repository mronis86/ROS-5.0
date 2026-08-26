import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppLogo from '../components/AppLogo';
import AppBrandTitle from '../components/AppBrandTitle';
import TrainingAdminPanel from '../components/training/TrainingAdminPanel';
import {
  ADMIN_UNLOCK_KEY,
  clearStoredAdminCredentials,
  describeAdminAuthFailure,
  fetchAdminAuthStatus,
  getStoredAdminKey,
  isAdminSessionUnlocked,
  setStoredAdminCredentials,
} from '../lib/adminAuth';

/**
 * Dedicated training management page (not under /admin).
 * Unlock with the same Admin key used elsewhere.
 */
const TrainingManagePage: React.FC = () => {
  const [unlocked, setUnlocked] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (isAdminSessionUnlocked()) setUnlocked(true);
  }, []);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setError(null);
    try {
      const status = await fetchAdminAuthStatus(keyInput.trim());
      if (!status.keyMatches) {
        setError(describeAdminAuthFailure(status));
        return;
      }
      setStoredAdminCredentials(keyInput.trim());
      sessionStorage.setItem(ADMIN_UNLOCK_KEY, '1');
      setUnlocked(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify admin key.');
    } finally {
      setChecking(false);
    }
  };

  const lock = () => {
    clearStoredAdminCredentials();
    setUnlocked(false);
    setKeyInput('');
  };

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/80 p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-5">
            <AppLogo size="sm" />
            <div>
              <AppBrandTitle titleClassName="text-base font-semibold text-white leading-tight" showTagline={false} />
              <p className="text-xs uppercase tracking-wide text-slate-500">Training management</p>
            </div>
          </div>
          <h1 className="text-xl font-semibold text-white mb-1">Manage training bookings</h1>
          <p className="text-sm text-slate-400 mb-5">
            Enter your admin key to view who booked training, cancel sessions, or block days.
          </p>
          {error ? (
            <div className="mb-3 rounded-lg border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}
          <form onSubmit={unlock} className="space-y-3">
            <label className="block text-xs text-slate-400">
              Admin key
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                autoComplete="current-password"
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                required
              />
            </label>
            <button
              type="submit"
              disabled={checking || !keyInput.trim()}
              className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2.5 text-sm"
            >
              {checking ? 'Checking…' : 'Unlock'}
            </button>
          </form>
          <p className="mt-4 text-center text-xs text-slate-500">
            Public booking page:{' '}
            <Link to="/training" className="text-blue-400 hover:text-blue-300">
              /training
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200">
      <header className="sticky top-0 z-30 border-b border-slate-700/80 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <AppLogo size="sm" />
            <div className="min-w-0">
              <AppBrandTitle titleClassName="text-sm font-semibold text-white leading-tight" showTagline={false} />
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Training management</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/training"
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
            >
              Public booking page
            </Link>
            <button
              type="button"
              onClick={lock}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-700 text-white hover:bg-slate-600"
              title={getStoredAdminKey() ? 'Lock this page' : undefined}
            >
              Lock
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold text-white">Training bookings</h1>
          <p className="text-sm text-slate-400 mt-1">
            See everyone who signed up, cancel a booking, or block days when you’re unavailable. Multiple people can
            book the same hour.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-700/80 bg-slate-900/70 p-5 sm:p-6 shadow-xl">
          <TrainingAdminPanel />
        </div>
      </main>
    </div>
  );
};

export default TrainingManagePage;
