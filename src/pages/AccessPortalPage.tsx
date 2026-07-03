import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AppBrandTitle from '../components/AppBrandTitle';
import AppLogo from '../components/AppLogo';
import { isNeonAuthEnabled } from '../lib/neonAuthClient';
import {
  completeAccountSetup,
  fetchAccessPortalStatus,
  type AccessPortalStatus,
} from '../lib/accessPortal';
import { setApiAccessToken } from '../lib/sessionAuth';
import { useAuth } from '../contexts/AuthContext';

const AccessPortalPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { applyPortalSession } = useAuth();
  const token = useMemo(() => searchParams.get('token')?.trim() || '', [searchParams]);

  const [loading, setLoading] = useState(true);
  const [portal, setPortal] = useState<AccessPortalStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!token) {
        setLoadError('This link is missing a token. Use the link from your access request email.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);
      const result = await fetchAccessPortalStatus(token);
      if (cancelled) return;

      if (!result.ok || !result.data) {
        setLoadError(result.error || 'Could not load your access status.');
        setPortal(null);
      } else {
        setPortal(result.data);
      }
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (password.length < 8) {
      setSubmitError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setSubmitError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await completeAccountSetup(token, password);
      if (!result.ok || !result.token) {
        setSubmitError(result.error || 'Could not set up your account.');
        return;
      }

      setApiAccessToken(result.token);
      applyPortalSession({
        token: result.token,
        email: result.email || portal?.email || '',
        full_name: result.full_name || portal?.full_name || '',
        neon_user_id: result.neon_user_id || '',
        status: result.status || 'approved',
        is_admin: result.is_admin,
      });
      navigate('/', { replace: true });
    } catch {
      setSubmitError('An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  const showWelcomeSetup = portal?.status === 'approved' && portal.needs_password_setup;
  const showPending = portal?.status === 'pending';
  const showRejected = portal?.status === 'rejected';
  const showReadyToSignIn = portal?.status === 'approved' && !portal.needs_password_setup;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <AppLogo size="lg" />
            <AppBrandTitle titleClassName="text-3xl font-bold text-white leading-tight" showTagline={false} />
          </div>
          <h1 className="text-2xl font-bold text-white">Access portal</h1>
          <p className="text-slate-400 text-sm mt-2">Check your request status or finish setting up your account.</p>
        </div>

        <div className="bg-slate-800 p-8 rounded-xl shadow-2xl border border-slate-700">
          {!isNeonAuthEnabled ? (
            <p className="text-amber-300 text-sm">
              Neon Auth is not configured for this build. Set <span className="font-mono">VITE_NEON_AUTH_URL</span>{' '}
              and redeploy.
            </p>
          ) : loading ? (
            <div className="text-center py-6">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mx-auto mb-4" />
              <p className="text-slate-400 text-sm">Loading your status…</p>
            </div>
          ) : loadError ? (
            <div className="space-y-4 text-center">
              <p className="text-red-300 text-sm">{loadError}</p>
              <Link
                to="/"
                className="inline-flex items-center justify-center w-full px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
              >
                Go to sign in
              </Link>
            </div>
          ) : showWelcomeSetup ? (
            <div className="space-y-5">
              <div className="text-center">
                <h2 className="text-xl font-semibold text-white">Welcome{portal?.full_name ? `, ${portal.full_name}` : ''}</h2>
                <p className="text-slate-400 text-sm mt-2">
                  Your access has been approved{portal?.is_admin ? ' as an administrator' : ''}. Choose a password to
                  finish setting up your account.
                </p>
                {portal?.email && (
                  <p className="text-slate-500 text-xs mt-2">
                    Account: <span className="text-slate-300">{portal.email}</span>
                  </p>
                )}
              </div>

              <form onSubmit={handleSetupSubmit} className="space-y-4">
                <div>
                  <label className="block text-slate-300 text-sm font-medium mb-2">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                    placeholder="At least 8 characters"
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 text-sm font-medium mb-2">Confirm password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                    placeholder="Re-enter your password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </div>

                {submitError && (
                  <div className="bg-red-900/80 border border-red-700 text-red-200 px-4 py-3 rounded-lg text-sm">
                    {submitError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                >
                  {submitting ? 'Setting up…' : 'Set password and continue'}
                </button>
              </form>
            </div>
          ) : showPending ? (
            <div className="space-y-4 text-center">
              <h2 className="text-xl font-semibold text-white">Awaiting approval</h2>
              <p className="text-slate-400 text-sm">
                Your access request for <span className="text-white">{portal?.email}</span> is pending review. An
                administrator will approve your account soon.
              </p>
              <p className="text-amber-200/90 text-xs bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
                Keep this page bookmarked or save this URL. You will need this same link after approval to set your
                password.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
              >
                Refresh status
              </button>
            </div>
          ) : showRejected ? (
            <div className="space-y-4 text-center">
              <h2 className="text-xl font-semibold text-white">Access not approved</h2>
              <p className="text-slate-400 text-sm">
                Your request for <span className="text-white">{portal?.email}</span> was not approved.
              </p>
              {portal?.notes && (
                <p className="text-slate-300 text-sm bg-slate-900/60 border border-slate-700 rounded-lg px-4 py-3">
                  {portal.notes}
                </p>
              )}
              <p className="text-slate-500 text-xs">Contact your administrator if you believe this is a mistake.</p>
              <Link
                to="/"
                className="inline-flex items-center justify-center w-full px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
              >
                Back to home
              </Link>
            </div>
          ) : showReadyToSignIn ? (
            <div className="space-y-4 text-center">
              <h2 className="text-xl font-semibold text-white">You&apos;re all set</h2>
              <p className="text-slate-400 text-sm">
                Your account for <span className="text-white">{portal?.email}</span> is ready. Sign in to use Run of Show.
              </p>
              <Link
                to="/"
                className="inline-flex items-center justify-center w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
              >
                Go to sign in
              </Link>
            </div>
          ) : (
            <div className="space-y-4 text-center">
              <p className="text-slate-400 text-sm">Unable to determine your access status.</p>
              <Link
                to="/"
                className="inline-flex items-center justify-center w-full px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
              >
                Go to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccessPortalPage;
