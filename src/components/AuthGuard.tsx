import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import AuthModal from './AuthModal';
import AppHeader from './AppHeader';
import AppLogo from './AppLogo';
import AppBrandTitle from './AppBrandTitle';
import { isNeonAuthEnabled } from '../lib/neonAuthClient';

interface AuthGuardProps {
  children: React.ReactNode;
}

const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { user, loading, accessStatus, refreshAccessStatus } = useAuth();
  const [showAuthModal, setShowAuthModal] = React.useState(false);
  const [refreshingAccess, setRefreshingAccess] = React.useState(false);

  const canUseApp =
    !loading &&
    !!user &&
    accessStatus === 'approved';

  const showGate = !canUseApp;

  React.useEffect(() => {
    if (!loading && !user) {
      setShowAuthModal(true);
    } else if (user) {
      setShowAuthModal(false);
    }
  }, [user, loading]);

  const pendingApproval =
    isNeonAuthEnabled && user && accessStatus !== 'approved' && accessStatus !== 'rejected';
  const rejected = accessStatus === 'rejected';

  const handleRefreshAccess = async () => {
    setRefreshingAccess(true);
    try {
      await refreshAccessStatus();
    } finally {
      setRefreshingAccess(false);
    }
  };

  return (
    <>
      {canUseApp ? children : null}
      {showGate && (
        <div className="fixed inset-0 z-[100] min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 pt-[var(--app-header-height)]">
          <AppHeader />
          <div className="flex items-center justify-center h-[calc(100vh-80px)] px-4">
            {loading ? (
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
                <p className="text-slate-300">Loading...</p>
              </div>
            ) : rejected ? (
              <div className="text-center max-w-lg mx-auto p-8">
                <h2 className="text-2xl font-bold text-white mb-3">Access declined</h2>
                <p className="text-slate-300 mb-6">
                  Your request to use Run of Show was not approved. Contact your administrator if you believe this is a mistake.
                </p>
              </div>
            ) : pendingApproval ? (
              <div className="text-center max-w-lg mx-auto p-8 space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-white mb-3">Awaiting approval</h2>
                  <p className="text-slate-300 mb-2">
                    Signed in as <span className="text-white">{user?.email}</span>
                  </p>
                  <p className="text-slate-400">
                    Your access request is pending. An administrator must approve your account before you can use Run of Show.
                  </p>
                  <p className="text-slate-500 text-sm mt-4">
                    Administrator? Open{' '}
                    <a href="/admin" className="text-blue-400 hover:text-blue-300 underline">
                      Admin
                    </a>{' '}
                    (admin key required) to approve access requests.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={handleRefreshAccess}
                    disabled={refreshingAccess}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
                  >
                    {refreshingAccess ? 'Checking…' : 'Check approval status'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full max-w-2xl mx-auto px-4">
                <div className="mb-8 text-center">
                  <div className="flex items-center justify-center gap-3 mb-4">
                    <AppLogo size="lg" />
                    <AppBrandTitle
                      titleClassName="text-4xl font-bold text-white leading-tight"
                      showTagline={false}
                    />
                  </div>
                  <p className="text-slate-300 text-lg whitespace-nowrap max-sm:whitespace-normal">
                    Please sign in to access the Run of Show application.
                  </p>
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
