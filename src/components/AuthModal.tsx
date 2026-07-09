import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import DisclaimerModal from './DisclaimerModal';
import LoginAttemptWarningModal from './LoginAttemptWarningModal';
import { isNeonAuthEnabled } from '../lib/neonAuthClient';
import { requestPasswordReset } from '../lib/neonPasswordReset';
import ReportIssueButton from './ReportIssueButton';
import type { LoginRateLimitInfo } from '../lib/loginRateLimit';

type AuthMode = 'signin' | 'request' | 'forgot';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** When set, open directly on that tab (e.g. after pending screen). */
  initialMode?: AuthMode;
  /** Fired when access request is submitted so parent can adjust layout (e.g. hide branding). */
  onRequestSentChange?: (sent: boolean) => void;
}

const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialMode = 'signin',
  onRequestSentChange,
}) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [requestMessage, setRequestMessage] = useState<string | null>(null);
  const [requestPortalUrl, setRequestPortalUrl] = useState<string | null>(null);
  const [requestPortalCopied, setRequestPortalCopied] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [loginWarningInfo, setLoginWarningInfo] = useState<LoginRateLimitInfo | null>(null);
  const [showLoginWarning, setShowLoginWarning] = useState(false);

  const { signIn, requestAccess } = useAuth();

  const isRequestAccess = mode === 'request';
  const isForgotPassword = mode === 'forgot';

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setPassword('');
    setForgotSent(false);
    setRequestSent(false);
    setRequestMessage(null);
    setRequestPortalUrl(null);
    setRequestPortalCopied(false);
    setLoginWarningInfo(null);
    setShowLoginWarning(false);
    onRequestSentChange?.(false);
  };

  const copyRequestPortalUrl = async () => {
    if (!requestPortalUrl) return;
    try {
      await navigator.clipboard.writeText(requestPortalUrl);
      setRequestPortalCopied(true);
      window.setTimeout(() => setRequestPortalCopied(false), 2500);
    } catch {
      setError('Could not copy link. Select and copy it manually.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isForgotPassword) {
        const result = await requestPasswordReset(email);
        if (!result.ok) {
          setError(result.error || 'Could not send reset link.');
        } else {
          setForgotSent(true);
        }
        return;
      }

      const result = isRequestAccess
        ? await requestAccess(email, fullName)
        : await signIn(email, password, fullName);

      if (result.error) {
        setError(result.error.message || 'An error occurred');
        const rateLimit = result.loginRateLimit;
        if (rateLimit && (rateLimit.showWarning || rateLimit.isLockedOut)) {
          setLoginWarningInfo(rateLimit);
          setShowLoginWarning(true);
        }
      } else if (isRequestAccess) {
        setRequestSent(true);
        onRequestSentChange?.(true);
        setRequestMessage(result.message || 'Check your email for a link to view your access status.');
        setRequestPortalUrl(result.portalUrl || null);
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
      <LoginAttemptWarningModal
        isOpen={showLoginWarning}
        info={loginWarningInfo}
        onClose={() => setShowLoginWarning(false)}
      />

      <div
        className={`bg-slate-800 rounded-xl shadow-2xl w-full mx-auto border border-slate-700 ${
          requestSent ? 'max-w-xl p-6 sm:p-8' : 'max-w-md p-8'
        }`}
      >
        {isForgotPassword ? (
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-white">Forgot password</h2>
            <p className="text-slate-400 text-sm mt-2">
              Enter your email and we&apos;ll send a link to reset your password.
            </p>
          </div>
        ) : requestSent ? (
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-white">Access request received</h2>
            <p className="text-slate-400 text-sm mt-2">
              Save your personal link below before you leave this page.
            </p>
          </div>
        ) : (
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
        )}

        {forgotSent ? (
          <div className="space-y-4">
            <div className="bg-green-900/40 border border-green-700 text-green-200 px-4 py-3 rounded-lg text-sm">
              If an account exists for <span className="font-medium text-white">{email}</span>, a reset link
              has been sent. Check your inbox — links expire after 15 minutes.
            </div>
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="w-full px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
            >
              Back to sign in
            </button>
          </div>
        ) : requestSent ? (
          <div className="space-y-4 min-w-0">
            <div className="bg-amber-900/30 border border-amber-600/50 text-amber-100 px-4 py-3 rounded-lg text-sm leading-relaxed">
              <strong className="text-amber-50">Important:</strong> Copy or bookmark your link now. You need it after
              approval to set your password.
            </div>
            <div className="bg-green-900/40 border border-green-700 text-green-200 px-4 py-3 rounded-lg text-sm leading-relaxed">
              {requestMessage || (
                <>
                  We received your request for <span className="font-medium text-white">{email}</span>.
                </>
              )}
            </div>
            {requestPortalUrl ? (
              <div className="rounded-lg border border-slate-600 bg-slate-900/60 p-4 space-y-3 min-w-0">
                <p className="text-slate-300 text-sm font-medium">Your personal access link</p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Keep this somewhere safe — notes app, password manager, or email draft.
                </p>
                <div className="max-h-36 overflow-y-auto overflow-x-auto rounded-lg border border-slate-700 bg-slate-950/60">
                  <p className="text-xs text-slate-300 break-all font-mono p-3 leading-relaxed select-all">
                    {requestPortalUrl}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <a
                    href={requestPortalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Open access page
                  </a>
                  <button
                    type="button"
                    onClick={() => void copyRequestPortalUrl()}
                    className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {requestPortalCopied ? 'Copied!' : 'Copy link'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-amber-300 text-sm leading-relaxed">
                No portal link was returned. Ask an administrator to send your link from the Admin page.
              </p>
            )}
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="w-full px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
            >
              Back to sign in
            </button>
          </div>
        ) : (
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

            {!isForgotPassword && !isRequestAccess && (
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-2">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                  placeholder="Your password"
                  required
                  autoComplete="current-password"
                />
                {isNeonAuthEnabled && (
                  <div className="mt-2 text-right">
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      className="text-xs font-medium text-blue-400 hover:text-blue-300"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
              </div>
            )}

            {isRequestAccess && (
              <p className="text-xs leading-relaxed text-slate-400 text-center">
                Submit your name and email to request access. You will receive a personal link —{' '}
                <span className="text-slate-300">save it before you leave this page.</span>
              </p>
            )}

            {!isRequestAccess && !isForgotPassword && (
              <p className="text-xs leading-relaxed text-slate-400 text-center">
                If you would like, please{' '}
                <button
                  type="button"
                  onClick={() => setShowDisclaimer(true)}
                  className="font-medium text-slate-300 underline underline-offset-2 hover:text-slate-200"
                >
                  click here to read the Terms of Service
                </button>
                . By signing in, you automatically agree to these terms.
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
                : isForgotPassword
                  ? 'Send reset link'
                  : isRequestAccess
                    ? 'Submit access request'
                    : 'Sign in'}
            </button>

            {isForgotPassword && (
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="w-full px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
              >
                Back to sign in
              </button>
            )}

            {!isNeonAuthEnabled && isRequestAccess && (
              <p className="text-xs text-center text-amber-400/90">
                Neon Auth is not configured for this build. Set{' '}
                <span className="font-mono">VITE_NEON_AUTH_URL</span> in Netlify (or local{' '}
                <span className="font-mono">.env</span>) and redeploy.
              </p>
            )}

            <p className="text-center pt-1">
              <ReportIssueButton userEmail={email || undefined} userName={fullName || undefined} />
            </p>
          </form>
        )}
      </div>
    </>
  );
};

export default AuthModal;
