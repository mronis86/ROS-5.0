/**
 * Authentication: Neon Auth (preferred) or legacy API login fallback.
 */

import { getApiBaseUrl } from './api-client';
import { getApiAccessToken, setApiAccessToken } from '../lib/sessionAuth';
import { fetchNeonAccessToken, getNeonAuthClient, isNeonAuthEnabled } from '../lib/neonAuthClient';

const RAILWAY_URL = 'https://ros-50-production.up.railway.app';
const DOMAIN_CHECK_TIMEOUT_MS = 5000;

export type AccessStatus = 'none' | 'pending' | 'approved' | 'rejected';

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_admin?: boolean;
  accessStatus?: AccessStatus;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  accessStatus: AccessStatus;
}

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

function fetchWithTimeout(url: string, options: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function formatNeonAuthError(message: string): string {
  if (!/invalid origin/i.test(message)) return message;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const isLocalhost =
    /^https?:\/\/localhost(:\d+)?$/i.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin);
  if (origin && !isLocalhost) {
    return `Invalid origin (${origin}). Neon Auth only auto-trusts localhost. Open http://localhost:3003 or add "${origin}" in Neon Console → Auth → Configuration → Domains.`;
  }
  return 'Invalid origin. Enable Allow Localhost in Neon Console → Settings → Auth, and add your app URL under Auth → Configuration → Domains.';
}

class AuthService {
  private static instance: AuthService;
  private authState: AuthState = {
    user: null,
    isAuthenticated: false,
    loading: true,
    accessStatus: 'none',
  };

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  constructor() {
    void this.loadFromStorage();
  }

  private persistUserSession(user: User, accessStatus: AccessStatus) {
    localStorage.setItem(
      'ros_user_session',
      JSON.stringify({ user, accessStatus, created_at: new Date().toISOString() })
    );
  }

  private async syncApiTokenFromNeon() {
    const token = await fetchNeonAccessToken();
    if (token) setApiAccessToken(token);
    return token;
  }

  private async fetchAccessStatus(token: string): Promise<{
    status: AccessStatus;
    email?: string;
    full_name?: string;
    is_admin?: boolean;
    neon_user_id?: string;
  }> {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/auth/access-status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return { status: 'none' };
    }
    const data = await res.json();
    return {
      status: (data.status as AccessStatus) || 'none',
      email: data.email,
      full_name: data.full_name,
      is_admin: data.is_admin,
      neon_user_id: data.neon_user_id,
    };
  }

  private async submitAccessRequest(token: string, fullName: string) {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/auth/access-request`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ full_name: fullName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || 'Failed to request access');
    }
    return data as { status: AccessStatus; is_admin?: boolean; message?: string };
  }

  private async loadFromStorage() {
    try {
      if (isNeonAuthEnabled) {
        const neonAuthClient = getNeonAuthClient();
        if (!neonAuthClient) {
          this.authState.loading = false;
          return;
        }
        const sessionResult = await neonAuthClient.getSession();
        const neonUser = sessionResult.data?.user;
        if (neonUser) {
          await this.syncApiTokenFromNeon();
          const token = getApiAccessToken();
          if (token) {
            let access = await this.fetchAccessStatus(token);
            if (access.status === 'none') {
              try {
                const req = await this.submitAccessRequest(
                  token,
                  neonUser.name || neonUser.email?.split('@')[0] || 'User'
                );
                access = { ...access, status: req.status as AccessStatus, is_admin: req.is_admin };
              } catch {
                /* user may need to retry from UI */
              }
            }
            const user: User = {
              id: access.neon_user_id || neonUser.id,
              email: access.email || neonUser.email || '',
              full_name: access.full_name || neonUser.name || '',
              role: 'VIEWER',
              is_admin: access.is_admin,
              accessStatus: access.status,
            };
            this.authState = {
              user,
              isAuthenticated: true,
              loading: false,
              accessStatus: access.status,
            };
            this.persistUserSession(user, access.status);
            return;
          }
        }
        setApiAccessToken(null);
        this.authState = { user: null, isAuthenticated: false, loading: false, accessStatus: 'none' };
        return;
      }

      const token = getApiAccessToken();
      if (token) {
        const base = getApiBaseUrl();
        const res = await fetch(`${base}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const user: User = {
            id: data.user.id,
            email: data.user.email,
            full_name: data.user.full_name,
            role: data.user.role || 'VIEWER',
            is_admin: data.user.is_admin,
            accessStatus: 'approved',
          };
          this.authState = {
            user,
            isAuthenticated: true,
            loading: false,
            accessStatus: 'approved',
          };
          this.persistUserSession(user, 'approved');
          return;
        }
        setApiAccessToken(null);
      }

      this.authState.loading = false;
    } catch (error) {
      console.error('Error loading auth from storage:', error);
      this.authState.loading = false;
    }
  }

  private async checkDomain(email: string): Promise<{ allowed: boolean; message?: string }> {
    const base = getApiBaseUrl();
    const domainCheckOpts: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    };

    let checkRes: Response;
    if (isLocalBase(base)) {
      try {
        checkRes = await fetchWithTimeout(`${RAILWAY_URL}/api/auth/check-domain`, domainCheckOpts, DOMAIN_CHECK_TIMEOUT_MS);
      } catch {
        checkRes = await fetchWithTimeout(`${base}/api/auth/check-domain`, domainCheckOpts, DOMAIN_CHECK_TIMEOUT_MS);
      }
    } else {
      checkRes = await fetchWithTimeout(`${base}/api/auth/check-domain`, domainCheckOpts, DOMAIN_CHECK_TIMEOUT_MS);
    }

    if (!checkRes.ok && isLocalBase(base)) {
      checkRes = await fetchWithTimeout(`${RAILWAY_URL}/api/auth/check-domain`, domainCheckOpts, DOMAIN_CHECK_TIMEOUT_MS);
    }

    return checkRes.json().catch(() => ({ allowed: false, message: 'Unable to verify domain.' }));
  }

  async signIn(email: string, password: string, fullName?: string): Promise<{ error: any }> {
    try {
      if (isNeonAuthEnabled) {
        const neonAuthClient = getNeonAuthClient();
        if (!neonAuthClient) {
          return { error: { message: 'Neon Auth is not configured (missing VITE_NEON_AUTH_URL).' } };
        }
        const domainCheck = await this.checkDomain(email);
        if (!domainCheck.allowed) {
          return { error: { message: domainCheck.message || 'Your email domain is not approved.' } };
        }

        const result = await neonAuthClient.signIn.email({ email, password });
        if (result.error) {
          return { error: { message: formatNeonAuthError(result.error.message || 'Sign in failed.') } };
        }

        await this.syncApiTokenFromNeon();
        const token = getApiAccessToken();
        if (!token) {
          return {
            error: {
              message:
                'Could not obtain a Neon JWT for the API. Sign in again. If this persists, confirm Railway has NEON_AUTH_BASE_URL set to the same Auth URL as VITE_NEON_AUTH_URL.',
            },
          };
        }

        let access = await this.fetchAccessStatus(token);
        if (access.status === 'none') {
          try {
            const req = await this.submitAccessRequest(token, fullName || email.split('@')[0] || 'User');
            access = {
              ...access,
              status: req.status as AccessStatus,
              is_admin: req.is_admin,
            };
          } catch (err: any) {
            return {
              error: {
                message:
                  err?.message ||
                  'Signed in to Neon Auth but the API rejected your token. On Railway, set NEON_AUTH_BASE_URL to your Neon Auth URL and use the same Neon database branch as Auth.',
              },
            };
          }
        }

        const neonUser = result.data?.user;
        const user: User = {
          id: access.neon_user_id || neonUser?.id || '',
          email: access.email || neonUser?.email || email,
          full_name: access.full_name || neonUser?.name || fullName || '',
          role: 'VIEWER',
          is_admin: access.is_admin,
          accessStatus: access.status,
        };

        this.authState = {
          user,
          isAuthenticated: true,
          loading: false,
          accessStatus: access.status,
        };
        this.persistUserSession(user, access.status);
        return { error: null };
      }

      const domainCheck = await this.checkDomain(email);
      if (!domainCheck.allowed) {
        return { error: { message: domainCheck.message || 'Your email domain is not approved.' } };
      }

      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { error: { message: data.error || 'Invalid email or password.' } };
      }

      setApiAccessToken(data.token);
      const user: User = {
        id: data.user.id,
        email: data.user.email,
        full_name: data.user.full_name || fullName || '',
        role: data.user.role || 'VIEWER',
        is_admin: data.user.is_admin,
        accessStatus: 'approved',
      };
      this.authState = {
        user,
        isAuthenticated: true,
        loading: false,
        accessStatus: 'approved',
      };
      this.persistUserSession(user, 'approved');
      return { error: null };
    } catch (error: any) {
      return { error: { message: error?.message || 'Sign in failed.' } };
    }
  }

  async signUp(email: string, password: string, fullName: string): Promise<{ error: any }> {
    try {
      if (isNeonAuthEnabled) {
        const neonAuthClient = getNeonAuthClient();
        if (!neonAuthClient) {
          return { error: { message: 'Neon Auth is not configured (missing VITE_NEON_AUTH_URL).' } };
        }
        const domainCheck = await this.checkDomain(email);
        if (!domainCheck.allowed) {
          return { error: { message: domainCheck.message || 'Your email domain is not approved.' } };
        }

        const result = await neonAuthClient.signUp.email({
          name: fullName,
          email,
          password,
        });
        if (result.error) {
          return { error: { message: formatNeonAuthError(result.error.message || 'Sign up failed.') } };
        }

        return this.signIn(email, password, fullName);
      }

      return {
        error: {
          message: import.meta.env.PROD
            ? 'Neon Auth is not configured on this site. Add VITE_NEON_AUTH_URL in Netlify environment variables and redeploy.'
            : 'Neon Auth is not configured. Add VITE_NEON_AUTH_URL to your .env file and restart the dev server.',
        },
      };
    } catch (error: any) {
      return { error: { message: error?.message || 'Registration failed.' } };
    }
  }

  async signOut(): Promise<void> {
    if (isNeonAuthEnabled) {
      const neonAuthClient = getNeonAuthClient();
      if (neonAuthClient) {
        try {
          await neonAuthClient.signOut();
        } catch {
          /* ignore */
        }
      }
    } else {
      const token = getApiAccessToken();
      if (token) {
        try {
          const base = getApiBaseUrl();
          await fetch(`${base}/api/auth/logout`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch {
          /* ignore */
        }
      }
    }
    setApiAccessToken(null);
    localStorage.removeItem('ros_user_session');
    this.authState = { user: null, isAuthenticated: false, loading: false, accessStatus: 'none' };
  }

  getCurrentUser(): User | null {
    return this.authState.user;
  }

  getAccessStatus(): AccessStatus {
    return this.authState.accessStatus;
  }

  isAccessApproved(): boolean {
    return this.authState.accessStatus === 'approved';
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

  updateUserRole(role: string): void {
    if (this.authState.user) {
      this.authState.user.role = role;
      this.persistUserSession(this.authState.user, this.authState.accessStatus);
    }
  }

  async refreshAccessStatus(): Promise<AccessStatus> {
    const token = getApiAccessToken();
    if (!token || !isNeonAuthEnabled) return this.authState.accessStatus;
    await this.syncApiTokenFromNeon();
    const freshToken = getApiAccessToken();
    if (!freshToken) return this.authState.accessStatus;
    const access = await this.fetchAccessStatus(freshToken);
    this.authState.accessStatus = access.status;
    if (this.authState.user) {
      this.authState.user.accessStatus = access.status;
      this.authState.user.is_admin = access.is_admin;
      this.persistUserSession(this.authState.user, access.status);
    }
    return access.status;
  }
}

export const authService = AuthService.getInstance();
export type { User, AuthState };
