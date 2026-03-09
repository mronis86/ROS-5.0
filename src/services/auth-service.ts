// Simple authentication service that works with our API
// For now, we'll use localStorage for user sessions

import { getApiBaseUrl } from './api-client';

const RAILWAY_URL = 'https://ros-50-production.up.railway.app';
const DOMAIN_CHECK_TIMEOUT_MS = 5000;

/** True if base is localhost, 127.0.0.1, or a private IP (so we can fallback to Railway on failure). */
function isLocalBase(base: string): boolean {
  if (base.includes('localhost') || base.includes('127.0.0.1')) return true;
  try {
    const u = new URL(base);
    const host = (u.hostname || '').toLowerCase();
    return /^192\.168\.\d+\.\d+$|^10\.\d+\.\d+\.\d+$|^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host);
  } catch {
    return false;
  }
}

function fetchWithTimeout(
  url: string,
  options: RequestInit,
  ms: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timeout)
  );
}

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
      const domainCheckOpts = {
        method: 'POST' as const,
        headers: { 'Content-Type': 'application/json' as const },
        body: JSON.stringify({ email })
      };

      let checkRes: Response;
      // When current base is "local" (localhost or private IP), try Railway first so we don't
      // wait for a timeout if the local server is down.
      if (isLocalBase(base)) {
        try {
          checkRes = await fetchWithTimeout(
            `${RAILWAY_URL}/api/auth/check-domain`,
            domainCheckOpts,
            DOMAIN_CHECK_TIMEOUT_MS
          );
        } catch {
          checkRes = await fetchWithTimeout(
            `${base}/api/auth/check-domain`,
            domainCheckOpts,
            DOMAIN_CHECK_TIMEOUT_MS
          );
        }
      } else {
        try {
          checkRes = await fetchWithTimeout(
            `${base}/api/auth/check-domain`,
            domainCheckOpts,
            DOMAIN_CHECK_TIMEOUT_MS
          );
        } catch (networkErr) {
          throw networkErr;
        }
      }

      // On failure when we used a local base, retry once with Railway (covers private IP + timeout)
      if (!checkRes.ok && isLocalBase(base)) {
        checkRes = await fetchWithTimeout(
          `${RAILWAY_URL}/api/auth/check-domain`,
          domainCheckOpts,
          DOMAIN_CHECK_TIMEOUT_MS
        );
      }
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
    } catch (error: any) {
      const isTimeout = error?.name === 'AbortError';
      const isNetwork = !error?.message || /failed to fetch|network error|load failed/i.test(String(error?.message));
      if (isTimeout || isNetwork) {
        return { error: { message: 'Unable to reach the server. Please check your connection and try again.' } };
      }
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

