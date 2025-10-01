import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import AuthModal from './AuthModal';
import AppHeader from './AppHeader';

interface AuthGuardProps {
  children: React.ReactNode;
}

const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { user, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = React.useState(false);

  React.useEffect(() => {
    if (!loading && !user) {
      setShowAuthModal(true);
    } else if (user) {
      setShowAuthModal(false);
    }
  }, [user, loading]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 pt-16">
        <AppHeader />
        <div className="flex items-center justify-center h-[calc(100vh-80px)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-slate-300">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 pt-16">
        <AppHeader />
        <div className="flex items-center justify-center h-[calc(100vh-80px)]">
          <div className="text-center max-w-md mx-auto p-8">
            <div className="mb-8">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-2xl">R</span>
                </div>
                <h1 className="text-4xl font-bold text-white">Run of Show</h1>
              </div>
              <p className="text-slate-300 text-lg">
                Please sign in to access the Run of Show application.
              </p>
            </div>
            <AuthModal
              isOpen={showAuthModal}
              onClose={() => {}} // Don't allow closing - user must authenticate
              onSuccess={() => {
                setShowAuthModal(false);
              }}
            />
            
            {/* Sign In Button for when user wants to switch back */}
            <div className="mt-4 text-center">
              <button
                onClick={() => setShowAuthModal(true)}
                className="text-blue-400 hover:text-blue-300 text-sm underline"
              >
                Already have an account? Sign in here
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AuthGuard;
