import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import DisclaimerModal from './DisclaimerModal';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  const { signIn } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await signIn(email, fullName);

      if (result.error) {
        setError(result.error.message || 'An error occurred');
      } else {
        onSuccess();
        onClose();
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setEmail('');
    setFullName('');
    setError(null);
  };

  if (!isOpen) return null;

  return (
    <>
      <DisclaimerModal isOpen={showDisclaimer} onClose={() => setShowDisclaimer(false)} />

      <div className="bg-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-md mx-auto border border-slate-700">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white text-center">
          Enter Your Information
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-slate-300 text-sm font-medium mb-2">
            Full Name
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            placeholder="Enter your full name"
            required
          />
        </div>

        <div>
          <label className="block text-slate-300 text-sm font-medium mb-2">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            placeholder="Enter your email"
            required
          />
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            If you would like, please{' '}
            <button
              type="button"
              onClick={() => setShowDisclaimer(true)}
              className="font-medium text-blue-400 underline underline-offset-2 hover:text-blue-300"
            >
              click here to read the Terms of Service
            </button>
            . By signing in, you automatically agree to these terms.
          </p>
        </div>

        {error && (
          <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {loading ? 'Loading...' : 'Continue'}
        </button>
      </form>
    </div>
    </>
  );
};

export default AuthModal;