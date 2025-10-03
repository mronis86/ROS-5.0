import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';

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
      // Try to fetch from user_profiles table first
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error) {
        console.log('No profile found in database, using user metadata:', error);
        // Fallback to user metadata if no profile exists
        const profileData = {
          id: user.id,
          full_name: user.user_metadata?.full_name || user.email || 'Unknown',
          role: user.user_metadata?.role || 'VIEWER',
          email: user.email || '',
          created_at: user.created_at || new Date().toISOString()
        };
        setProfile(profileData);
        setFullName(profileData.full_name);
        setRole(profileData.role);
      } else {
        setProfile(data);
        setFullName(data.full_name || '');
        setRole(data.role || 'VIEWER');
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      // Fallback to user metadata
      const profileData = {
        id: user.id,
        full_name: user.user_metadata?.full_name || user.email || 'Unknown',
        role: user.user_metadata?.role || 'VIEWER',
        email: user.email || '',
        created_at: user.created_at || new Date().toISOString()
      };
      setProfile(profileData);
      setFullName(profileData.full_name);
      setRole(profileData.role);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    try {
      // Update user metadata
      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          full_name: fullName,
          role: role
        }
      });

      if (updateError) {
        console.error('Error updating user metadata:', updateError);
        setError('Failed to update profile');
        return;
      }

      // Update or insert into user_profiles table
      const { error: upsertError } = await supabase
        .from('user_profiles')
        .upsert({
          user_id: user.id,
          full_name: fullName,
          role: role,
          updated_at: new Date().toISOString()
        });

      if (upsertError) {
        console.error('Error upserting profile:', upsertError);
        setError('Failed to save profile to database');
        return;
      }

      // Update local state
      setProfile(prev => prev ? {
        ...prev,
        full_name: fullName,
        role: role
      } : null);

      setEditing(false);
      setError(null);
    } catch (error) {
      console.error('Error saving profile:', error);
      setError('An unexpected error occurred');
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
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
        Loading...
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="text-slate-300">
        Profile not found
      </div>
    );
  }

  return (
    <div className="bg-slate-800 p-4 rounded-lg shadow-2xl w-80 border border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Profile</h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1">
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
              placeholder="Enter your full name"
            />
          </div>
          
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
            >
              {roles.map((roleOption) => (
                <option key={roleOption.value} value={roleOption.value}>
                  {roleOption.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 text-white text-sm rounded transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-2 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white font-medium">
              {(profile.full_name || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-white font-medium">{profile.full_name}</div>
              <div className="text-slate-400 text-sm">{profile.role}</div>
              <div className="text-slate-500 text-xs">{user?.email}</div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setEditing(true)}
              className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
            >
              Edit Profile
            </button>
            <button
              onClick={handleSignOut}
              className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded transition-colors"
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
