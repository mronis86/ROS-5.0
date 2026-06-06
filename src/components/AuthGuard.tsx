import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import AuthModal from './AuthModal';
import AppHeader from './AppHeader';
import AppLogo from './AppLogo';
import AppBrandTitle from './AppBrandTitle';

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

  const showBlockingOverlay = loading || !user;

  return (
    <>
      {children}
      {showBlockingOverlay && (
        <div className="fixed inset-0 z-[100] min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 pt-16">
          <AppHeader />
          <div className="flex items-center justify-center h-[calc(100vh-80px)]">
            {loading ? (
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
                <p className="text-slate-300">Loading...</p>
              </div>
            ) : (
              <div className="text-center max-w-2xl mx-auto p-8">
                <div className="mb-8">
                  <div className="flex items-center justify-center gap-3 mb-4">
                    <AppLogo size="lg" />
                    <AppBrandTitle
                      titleClassName="text-4xl font-bold text-white leading-tight"
                      showTagline={false}
                    />
                  </div>
                  <p className="text-slate-300 text-lg">Please sign in to access the Run of Show application.</p>
                </div>
                <AuthModal
                  isOpen={showAuthModal}
                  onClose={() => {}}
                  onSuccess={() => {
                    setShowAuthModal(false);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default AuthGuard;
