import React, { createContext, useContext, useEffect, useState } from 'react';
import { authService, User } from '../services/auth-service';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, fullName: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
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

  useEffect(() => {
    // Initialize auth state from our service
    const authState = authService.getAuthState();
    setUser(authState.user);
    setLoading(authState.loading);
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    const result = await authService.signUp(email, password, fullName);
    if (!result.error) {
      setUser(authService.getCurrentUser());
    }
    return result;
  };

  const signIn = async (email: string, fullName: string) => {
    const result = await authService.signIn(email, fullName);
    if (!result.error) {
      setUser(authService.getCurrentUser());
    }
    return result;
  };

  const signOut = async () => {
    await authService.signOut();
    setUser(null);
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

  const value = {
    user,
    loading,
    signUp,
    signIn,
    signOut,
    updateProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
