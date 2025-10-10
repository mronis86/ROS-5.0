import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/database';

interface RoleSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRoleSelected: (role: string) => void;
  eventId: string;
}

const RoleSelectionModal: React.FC<RoleSelectionModalProps> = ({ 
  isOpen, 
  onClose, 
  onRoleSelected, 
  eventId 
}) => {
  const { user } = useAuth();
  const [selectedRole, setSelectedRole] = useState<'VIEWER' | 'OPERATOR' | 'EDITOR'>('VIEWER');
  const [loading, setLoading] = useState(false);

  // Pre-select user's current role if they have one saved
  useEffect(() => {
    if (isOpen && user?.id && eventId) {
      const savedRole = localStorage.getItem(`user_role_${eventId}_${user.id}`);
      if (savedRole && ['VIEWER', 'EDITOR', 'OPERATOR'].includes(savedRole)) {
        setSelectedRole(savedRole as 'VIEWER' | 'EDITOR' | 'OPERATOR');
      }
    }
  }, [isOpen, user?.id, eventId]);

  const roles = [
    { 
      value: 'VIEWER', 
      label: 'Viewer (Read Only)', 
      description: 'Can view but cannot edit any content',
      icon: '👁️'
    },
    { 
      value: 'OPERATOR', 
      label: 'Operator (Limited Edit)', 
      description: 'Can control timers and view data',
      icon: '🎮'
    },
    { 
      value: 'EDITOR', 
      label: 'Editor (Full Access)', 
      description: 'Can edit all content and settings',
      icon: '✏️'
    },
  ];

  const handleRoleSelection = async () => {
    if (!user || !eventId) return;

    setLoading(true);
    try {
      // Save user session with selected role
      const success = await DatabaseService.saveUserSession(
        eventId,
        user.id,
        user.user_metadata?.full_name || user.email || 'Unknown',
        selectedRole
      );

      if (success) {
        onRoleSelected(selectedRole);
        onClose();
      } else {
        alert('Failed to save user session. Please try again.');
      }
    } catch (error) {
      console.error('Error saving user session:', error);
      alert('Error saving user session. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[9999] p-4">
      <div className="bg-slate-800 p-8 rounded-xl shadow-2xl max-w-2xl w-full">
        <div className="text-center mb-6">
          <h2 className="text-3xl font-bold text-white mb-2">Select Your Role</h2>
          <p className="text-slate-300 text-lg">
            Welcome, {user?.user_metadata?.full_name || user?.email}! 
            Please select your role for this session.
          </p>
        </div>

        <div className="space-y-4 mb-8">
          {roles.map((role) => (
            <label
              key={role.value}
              className={`flex items-start gap-4 cursor-pointer p-4 rounded-lg border-2 transition-colors ${
                selectedRole === role.value
                  ? 'border-blue-500 bg-blue-900/20'
                  : 'border-slate-600 hover:border-blue-400'
              }`}
            >
              <input
                type="radio"
                name="role"
                value={role.value}
                checked={selectedRole === role.value}
                onChange={(e) => setSelectedRole(e.target.value as 'VIEWER' | 'OPERATOR' | 'EDITOR')}
                className="w-5 h-5 text-blue-600 mt-1"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xl">{role.icon}</span>
                  <span className="text-white font-bold text-lg">{role.label}</span>
                </div>
                <p className="text-slate-300 text-sm">{role.description}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="flex gap-4">
          <button
            onClick={handleRoleSelection}
            disabled={loading}
            className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
          >
            {loading ? 'Loading...' : 'Continue with Selected Role'}
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>

        <div className="mt-4 p-3 bg-blue-900 rounded-lg">
          <p className="text-blue-200 text-sm">
            <strong>Note:</strong> You can change your role later from your profile menu.
          </p>
        </div>
      </div>
    </div>
  );
};

export default RoleSelectionModal;
