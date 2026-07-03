import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import AuthModal from './AuthModal';
import AppHeader from './AppHeader';
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
        <div className="fixed inset-0 z-[100] flex flex-col min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 pt-[var(--app-header-height)]">
          <AppHeader />
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="flex min-h-full items-start sm:items-center justify-center px-4 py-6 sm:py-10">
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
              <div className="w-full max-w-2xl mx-auto px-2 sm:px-4 min-w-0">
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
        </div>
      )}
    </>
  );
};

export default AuthGuard;
