import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppBrandTitle from '../components/AppBrandTitle';
import AppLogo from '../components/AppLogo';
import { isNeonAuthEnabled } from '../lib/neonAuthClient';
import { resetPasswordWithToken } from '../lib/neonPasswordReset';

const ResetPasswordPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const token = useMemo(() => searchParams.get('token')?.trim() || '', [searchParams]);
  const linkError = useMemo(() => searchParams.get('error')?.trim() || '', [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError('This reset link is missing a token. Request a new link from the sign-in page.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const result = await resetPasswordWithToken(token, password);
      if (!result.ok) {
        setError(result.error || 'Could not reset password.');
        return;
      }
      setSuccess(true);
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <AppLogo size="lg" />
            <AppBrandTitle titleClassName="text-3xl font-bold text-white leading-tight" showTagline={false} />
          </div>
          <h1 className="text-2xl font-bold text-white">Reset password</h1>
          <p className="text-slate-400 text-sm mt-2">Choose a new password for your account.</p>
        </div>

        <div className="bg-slate-800 p-8 rounded-xl shadow-2xl border border-slate-700">
          {!isNeonAuthEnabled ? (
            <p className="text-amber-300 text-sm">
              Neon Auth is not configured for this build. Set <span className="font-mono">VITE_NEON_AUTH_URL</span>{' '}
              and redeploy.
            </p>
          ) : success ? (
            <div className="space-y-4 text-center">
              <p className="text-green-300 text-sm">Your password has been updated. You can sign in with your new password.</p>
              <Link
                to="/"
                className="inline-flex items-center justify-center w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
              >
                Go to sign in
              </Link>
            </div>
          ) : !token || linkError ? (
            <div className="space-y-4 text-center">
              <p className="text-red-200 text-sm">
                {linkError
                  ? 'This reset link is invalid or has expired. Links expire after 15 minutes.'
                  : 'This reset link is invalid or incomplete.'}
              </p>
              <Link
                to="/"
                className="inline-flex items-center justify-center w-full px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-2">New password</label>
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
                  placeholder="Repeat new password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <div className="bg-red-900/80 border border-red-700 text-red-200 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
