import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import UserProfile from './UserProfile';
import AppLogo from './AppLogo';
import AppBrandTitle from './AppBrandTitle';

const AppHeader: React.FC = () => {
  const { user, signOut } = useAuth();
  const [showProfile, setShowProfile] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-slate-800 border-b border-slate-700 px-5 py-2">
      <div className="flex items-center justify-between gap-4">
        {/* Logo and Title */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-1.5">
            <AppLogo size="sm" />
            <AppBrandTitle
              titleClassName="text-base font-bold text-white leading-none"
              taglineClassName="text-[9px] uppercase tracking-[0.06em] text-slate-500 leading-none"
            />
          </div>
        </div>

        {/* User Profile Section */}
        {user ? (
          <div className="flex items-center gap-4 shrink-0">
            {/* User Details */}
            <div className="text-right">
              <p className="text-white font-semibold text-base">
                {user.full_name || user.email}
              </p>
              <p className="text-slate-300 text-xs">
                {user.email}
              </p>
            </div>

            {/* Logout Button */}
            <button
              onClick={() => {
                if (confirm('Are you sure you want to sign out?')) {
                  signOut();
                }
              }}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm rounded-md transition-colors"
              title="Sign out"
            >
              Sign Out
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="text-slate-400 text-sm">
              Please sign in to continue
            </div>
          </div>
        )}

        {/* Profile Dropdown */}
        {showProfile && (
          <div className="absolute top-16 right-6 z-50">
            <UserProfile onClose={() => setShowProfile(false)} />
          </div>
        )}
      </div>
    </header>
  );
};

export default AppHeader;
