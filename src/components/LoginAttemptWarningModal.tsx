import React from 'react';
import type { LoginRateLimitInfo } from '../lib/loginRateLimit';

interface LoginAttemptWarningModalProps {
  isOpen: boolean;
  info: LoginRateLimitInfo | null;
  onClose: () => void;
}

const LoginAttemptWarningModal: React.FC<LoginAttemptWarningModalProps> = ({ isOpen, info, onClose }) => {
  if (!isOpen || !info) return null;

  const { attemptsRemaining, lockoutMinutes, isLockedOut } = info;

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-attempt-warning-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-amber-600/60 bg-slate-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-700 px-6 py-4">
          <h2 id="login-attempt-warning-title" className="text-lg font-semibold text-white">
            {isLockedOut ? 'Sign-in temporarily blocked' : 'Sign-in attempt warning'}
          </h2>
        </div>

        <div className="space-y-3 px-6 py-5 text-sm leading-relaxed text-slate-300">
          {isLockedOut ? (
            <p>
              Too many failed sign-in attempts. Please wait{' '}
              <span className="font-semibold text-white">{lockoutMinutes} minutes</span> before trying again.
            </p>
          ) : (
            <p>
              You have{' '}
              <span className="font-semibold text-amber-200">
                {attemptsRemaining} more attempt{attemptsRemaining === 1 ? '' : 's'}
              </span>{' '}
              before sign-in is blocked for{' '}
              <span className="font-semibold text-white">{lockoutMinutes} minutes</span>.
            </p>
          )}
          <p className="text-slate-400">
            Double-check your email and password. If you forgot your password, use the forgot password link.
          </p>
        </div>

        <div className="border-t border-slate-700 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500"
          >
            I understand
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginAttemptWarningModal;
