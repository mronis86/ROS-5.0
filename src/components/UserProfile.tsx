import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface UserProfileData {
  id: string;
  full_name: string;
  role: string;
  email: string;
  created_at: string;
}

interface UserProfileProps {
  onClose?: () => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ onClose }) => {
  const { user, signOut, updateProfile } = useAuth();
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('VIEWER');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles = [
    { value: 'VIEWER', label: 'Viewer (Read Only)' },
    { value: 'OPERATOR', label: 'Operator (Limited Edit)' },
    { value: 'EDITOR', label: 'Editor (Full Access)' },
  ];

  useEffect(() => {
    if (user) {
      fetchProfile();
    }
  }, [user]);

  const fetchProfile = async () => {
    if (!user) return;

    try {
      const profileData = {
        id: user.id,
        full_name: user.full_name || user.email || 'Unknown',
        role: user.role || 'VIEWER',
        email: user.email || '',
        created_at: user.created_at || new Date().toISOString(),
      };
      setProfile(profileData);
      setFullName(profileData.full_name);
      setRole(profileData.role);
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    try {
      await updateProfile({
        full_name: fullName,
        role: role,
      });

      setProfile((prev) =>
        prev
          ? {
              ...prev,
              full_name: fullName,
              role: role,
            }
          : null
      );

      setEditing(false);
      setError(null);
    } catch (error) {
      console.error('Error saving profile:', error);
      setError('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    if (confirm('Are you sure you want to sign out?')) {
      await signOut();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-300">
        <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-blue-500"></div>
        Loading...
      </div>
    );
  }

  if (!profile) {
    return <div className="text-slate-300">Profile not found</div>;
  }

  return (
    <div className="w-80 rounded-lg border border-slate-700 bg-slate-800 p-4 shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-white">Profile</h3>
        {onClose && (
          <button onClick={onClose} className="text-slate-400 transition-colors hover:text-white">
            ✕
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white"
              placeholder="Enter your full name"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white"
            >
              {roles.map((roleOption) => (
                <option key={roleOption.value} value={roleOption.value}>
                  {roleOption.label}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="rounded border border-red-700 bg-red-900 px-3 py-2 text-sm text-red-200">{error}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 rounded bg-green-600 px-3 py-2 text-sm text-white transition-colors hover:bg-green-500 disabled:bg-slate-600"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded bg-slate-600 px-3 py-2 text-sm text-white transition-colors hover:bg-slate-500"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 font-medium text-white">
              {(profile.full_name || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-medium text-white">{profile.full_name}</div>
              <div className="text-sm text-slate-400">{profile.role}</div>
              <div className="text-xs text-slate-500">{user?.email}</div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setEditing(true)}
              className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm text-white transition-colors hover:bg-blue-500"
            >
              Edit Profile
            </button>
            <button
              onClick={handleSignOut}
              className="rounded bg-red-600 px-3 py-2 text-sm text-white transition-colors hover:bg-red-500"
              title="Sign out"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserProfile;
