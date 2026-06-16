import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import DisclaimerModal from './DisclaimerModal';
import { isNeonAuthEnabled } from '../lib/neonAuthClient';

type AuthMode = 'signin' | 'request';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** When set, open directly on that tab (e.g. after pending screen). */
  initialMode?: AuthMode;
}

const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialMode = 'signin',
}) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  const { signIn, signUp } = useAuth();

  const isRequestAccess = mode === 'request';

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = isRequestAccess
        ? await signUp(email, password, fullName)
        : await signIn(email, password, fullName);

      if (result.error) {
        setError(result.error.message || 'An error occurred');
      } else {
        onSuccess();
        onClose();
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <DisclaimerModal isOpen={showDisclaimer} onClose={() => setShowDisclaimer(false)} />

      <div className="bg-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-md mx-auto border border-slate-700">
        <div
          className="flex rounded-lg bg-slate-900/80 p-1 mb-6 border border-slate-700"
          role="tablist"
          aria-label="Authentication mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            onClick={() => switchMode('signin')}
            className={`flex-1 py-2.5 px-3 rounded-md text-sm font-medium transition-colors ${
              mode === 'signin'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'request'}
            onClick={() => switchMode('request')}
            className={`flex-1 py-2.5 px-3 rounded-md text-sm font-medium transition-colors ${
              mode === 'request'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Request access
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRequestAccess && (
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">Full name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                placeholder="Your name"
                required
                autoComplete="name"
              />
            </div>
          )}

          <div>
            <label className="block text-slate-300 text-sm font-medium mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder="you@company.com"
              required
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-slate-300 text-sm font-medium mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              placeholder={isRequestAccess ? 'At least 8 characters' : 'Your password'}
              required
              minLength={isRequestAccess ? 8 : undefined}
              autoComplete={isRequestAccess ? 'new-password' : 'current-password'}
            />
          </div>

          {isRequestAccess && (
            <p className="text-xs leading-relaxed text-slate-400">
              Submitting creates your account and sends an access request to an administrator.
              You can sign in after your request is approved.
            </p>
          )}

          {!isRequestAccess && (
            <p className="text-xs leading-relaxed text-slate-400">
              By signing in, you agree to the{' '}
              <button
                type="button"
                onClick={() => setShowDisclaimer(true)}
                className="font-medium text-blue-400 underline underline-offset-2 hover:text-blue-300"
              >
                Terms of Service
              </button>
              .
            </p>
          )}

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
            {loading
              ? 'Please wait…'
              : isRequestAccess
                ? 'Submit access request'
                : 'Sign in'}
          </button>

          {!isNeonAuthEnabled && isRequestAccess && (
            <p className="text-xs text-center text-slate-500">
              First registered user becomes administrator when Neon Auth is not configured.
            </p>
          )}
        </form>
      </div>
    </>
  );
};

export default AuthModal;
