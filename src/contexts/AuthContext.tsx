import React, { createContext, useContext, useEffect, useState } from 'react';
import { authService, User, AccessStatus } from '../services/auth-service';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  accessStatus: import('../services/auth-service').AccessStatus;
  signIn: (email: string, password: string, fullName?: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: any }>;
  requestAccess: (email: string, fullName: string) => Promise<{
    error: any;
    status?: import('../services/auth-service').AccessStatus;
    message?: string;
    portalUrl?: string;
  }>;
  applyPortalSession: (session: {
    token: string;
    email: string;
    full_name: string;
    neon_user_id: string;
    status: import('../services/auth-service').AccessStatus;
    is_admin?: boolean;
    dashboard_enabled?: boolean;
  }) => void;
  signOut: () => Promise<void>;
  refreshAccessStatus: () => Promise<import('../services/auth-service').AccessStatus>;
  updateProfile: (updates: { full_name?: string; role?: string }) => Promise<{ error: any }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessStatus, setAccessStatus] = useState<AccessStatus>('none');

  useEffect(() => {
    const sync = () => {
      const authState = authService.getAuthState();
      setUser(authState.user);
      setAccessStatus(authState.accessStatus);
      setLoading(authState.loading);
    };
    sync();
    const timer = window.setTimeout(sync, 800);
    return () => window.clearTimeout(timer);
  }, []);

  const requestAccess = async (email: string, fullName: string) => {
    return authService.requestAccess(email, fullName);
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const result = await authService.signUp(email, password, fullName);
    if (!result.error) {
      setUser(authService.getCurrentUser());
      setAccessStatus(authService.getAccessStatus());
    }
    return result;
  };

  const signIn = async (email: string, password: string, fullName?: string) => {
    const result = await authService.signIn(email, password, fullName);
    if (!result.error) {
      setUser(authService.getCurrentUser());
      setAccessStatus(authService.getAccessStatus());
    }
    return result;
  };

  const refreshAccessStatus = async () => {
    const status = await authService.refreshAccessStatus();
    setAccessStatus(status);
    setUser(authService.getCurrentUser());
    return status;
  };

  const signOut = async () => {
    await authService.signOut();
    setUser(null);
    setAccessStatus('none');
  };

  const updateProfile = async (updates: { full_name?: string; role?: string }) => {
    try {
      // Update in our auth service
      if (updates.role) {
        authService.updateUserRole(updates.role);
      }
      setUser(authService.getCurrentUser());
      return { error: null };
    } catch (error) {
      return { error };
    }
  };

  const applyPortalSession = (session: {
    token: string;
    email: string;
    full_name: string;
    neon_user_id: string;
    status: AccessStatus;
    is_admin?: boolean;
  }) => {
    authService.applySessionFromPortal(session);
    setUser(authService.getCurrentUser());
    setAccessStatus(authService.getAccessStatus());
  };

  const value = {
    user,
    loading,
    accessStatus,
    signUp,
    requestAccess,
    applyPortalSession,
    signIn,
    signOut,
    refreshAccessStatus,
    updateProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
