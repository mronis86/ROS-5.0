import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import UserProfile from './UserProfile';

const AppHeader: React.FC = () => {
  const { user, signOut } = useAuth();
  const [showProfile, setShowProfile] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-slate-800 border-b border-slate-700 px-6 py-4">
      <div className="flex items-center justify-between">
        {/* Logo and Title */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">R</span>
            </div>
            <h1 className="text-xl font-bold text-white">Run of Show</h1>
          </div>
        </div>

        {/* User Profile Section */}
        {user ? (
          <div className="flex items-center gap-4">
            {/* User Details */}
            <div className="text-right">
              <p className="text-white font-semibold text-base">
                {user.user_metadata?.full_name || user.email}
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
