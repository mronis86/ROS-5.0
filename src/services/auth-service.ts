// Simple authentication service that works with our API
// For now, we'll use localStorage for user sessions

import { getApiBaseUrl } from './api-client';

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
}

class AuthService {
  private static instance: AuthService;
  private authState: AuthState = {
    user: null,
    isAuthenticated: false,
    loading: true
  };

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem('ros_user_session');
      if (stored) {
        const session = JSON.parse(stored);
        this.authState = {
          user: session.user,
          isAuthenticated: true,
          loading: false
        };
      } else {
        this.authState.loading = false;
      }
    } catch (error) {
      console.error('Error loading auth from storage:', error);
      this.authState.loading = false;
    }
  }

  async signIn(email: string, fullName: string): Promise<{ error: any }> {
    try {
      // Domain check: only allow sign-in if email domain is approved (or list is empty)
      const base = getApiBaseUrl();
      const checkRes = await fetch(`${base}/api/auth/check-domain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const checkData = await checkRes.json().catch(() => ({}));
      if (!checkData.allowed) {
        return { error: { message: checkData.message || 'Your email domain is not on the approved list. Contact an administrator.' } };
      }
      if (!checkRes.ok) {
        return { error: { message: 'Unable to verify domain. Please try again.' } };
      }

      // Simple user identification - no password needed
      // This is just for tracking who made changes
      const user: User = {
        id: `user_${Date.now()}`,
        email,
        full_name: fullName,
        role: 'VIEWER' // Default role
      };

      const session = {
        user,
        created_at: new Date().toISOString()
      };

      localStorage.setItem('ros_user_session', JSON.stringify(session));
      
      this.authState = {
        user,
        isAuthenticated: true,
        loading: false
      };

      return { error: null };
    } catch (error) {
      return { error };
    }
  }

  async signUp(email: string, fullName: string): Promise<{ error: any }> {
    // For now, same as sign in
    return this.signIn(email, fullName);
  }

  async signOut(): Promise<void> {
    localStorage.removeItem('ros_user_session');
    this.authState = {
      user: null,
      isAuthenticated: false,
      loading: false
    };
  }

  getCurrentUser(): User | null {
    return this.authState.user;
  }

  isAuthenticated(): boolean {
    return this.authState.isAuthenticated;
  }

  isLoading(): boolean {
    return this.authState.loading;
  }

  getAuthState(): AuthState {
    return { ...this.authState };
  }

  // Update user role (for role selection)
  updateUserRole(role: string): void {
    if (this.authState.user) {
      this.authState.user.role = role;
      
      // Update in storage
      const stored = localStorage.getItem('ros_user_session');
      if (stored) {
        const session = JSON.parse(stored);
        session.user.role = role;
        localStorage.setItem('ros_user_session', JSON.stringify(session));
      }
    }
  }
}

export const authService = AuthService.getInstance();
export type { User, AuthState };

