import React, { createContext, useContext } from 'react';
import { getOfflineDisplayName, getOfflineUserId } from '../services/offline-user';

export type OfflineUser = {
  id: string;
  email: string;
  user_metadata?: { full_name?: string; role?: string };
  full_name?: string;
};

type AuthContextValue = {
  user: OfflineUser | null;
  loading: boolean;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: false,
  signOut: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const name = getOfflineDisplayName();
  const user: OfflineUser = {
    id: getOfflineUserId(),
    email: 'offline@lan.show',
    full_name: name,
    user_metadata: { full_name: name, role: 'EDITOR' },
  };
  return (
    <AuthContext.Provider value={{ user, loading: false, signOut: () => {} }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  return useContext(AuthContext);
}
