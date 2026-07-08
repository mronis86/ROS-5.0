/**
 * Authentication: Neon Auth (preferred) or legacy API login fallback.
 */

import { getApiBaseUrl } from './api-client';
import { getApiAccessToken, setApiAccessToken } from '../lib/sessionAuth';
import {
  clearLocalFailedLogin,
  resolveLoginRateLimit,
  type LoginRateLimitInfo,
} from '../lib/loginRateLimit';
import {
  collectNeonAuthCredentials,
  fetchNeonAccessToken,
  getNeonAuthClient,
  isNeonAuthJwt,
  isNeonAuthEnabled,
  type NeonAuthCredentials,
} from '../lib/neonAuthClient';

const RAILWAY_URL = 'https://ros-50-production.up.railway.app';
const DOMAIN_CHECK_TIMEOUT_MS = 5000;

export type AccessStatus = 'none' | 'pending' | 'approved' | 'rejected';
export type { LoginRateLimitInfo } from '../lib/loginRateLimit';

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_admin?: boolean;
  dashboard_enabled?: boolean;
  accessStatus?: AccessStatus;
}

export function canAccessProductionDashboard(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.is_admin) return true;
  return user.dashboard_enabled === true;
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

function formatAuthApiError(
  data: Record<string, unknown>,
  fallback: string,
  status?: number
): string {
  const err = typeof data.error === 'string' ? data.error.trim() : '';
  const msg = typeof data.message === 'string' ? data.message.trim() : '';
  const hint = typeof data.hint === 'string' ? data.hint.trim() : '';
  const primary = err || msg;

  const isCredentialFailure =
    status === 401 ||
    (status === 400 &&
      /invalid email or password|incorrect password|invalid credentials/i.test(primary));

  if (isCredentialFailure && primary) {
    return primary;
  }

  const parts: string[] = [];
  if (primary) parts.push(primary);
  if (hint && hint.toLowerCase() !== primary.toLowerCase()) {
    parts.push(hint);
  }
  const code = typeof data.code === 'string' ? data.code.trim() : '';
  if (
    code &&
    code.toLowerCase() !== primary.toLowerCase() &&
    !primary.toLowerCase().includes(code.toLowerCase())
  ) {
    parts.push(`(${code})`);
  }
  const dbHost = typeof data.databaseHost === 'string' ? data.databaseHost.trim() : '';
  if (dbHost) parts.push(`DB: ${dbHost}`);
  const neonHost = typeof data.neonAuthHost === 'string' ? data.neonAuthHost.trim() : '';
  if (neonHost) parts.push(`API Neon Auth host: ${neonHost}`);

  return parts.join(' — ') || fallback;
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

  private async neonAuthApiRequest(
    path: '/api/auth/neon-login' | '/api/auth/neon-register',
    body: { email: string; password: string; full_name?: string }
  ): Promise<{
    ok: boolean;
    token: string | null;
    status: AccessStatus;
    email?: string;
    full_name?: string;
    is_admin?: boolean;
    neon_user_id?: string;
    dashboard_enabled?: boolean;
    error?: string;
    loginRateLimit?: LoginRateLimitInfo | null;
  }> {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    const loginRateLimit = resolveLoginRateLimit(
      res,
      data,
      body.email,
      res.status === 401 || res.status === 429
    );
    if (!res.ok || !data.token) {
      setApiAccessToken(null);
      return {
        ok: false,
        token: null,
        status: 'none',
        loginRateLimit,
        error:
          formatAuthApiError(
            data,
            'Could not sign in. Confirm Railway has NEON_AUTH_BASE_URL and migrations 027/028 applied.',
            res.status
          ),
      };
    }

    clearLocalFailedLogin(body.email);
    setApiAccessToken(data.token);
    return {
      ok: true,
      token: data.token,
      status: (data.status as AccessStatus) || 'none',
      email: data.email,
      full_name: data.full_name,
      is_admin: data.is_admin,
      neon_user_id: data.neon_user_id,
      dashboard_enabled: data.dashboard_enabled,
    };
  }

  private async exchangeNeonSessionForApiToken(
    fullNameHint?: string,
    neonHints?: Partial<NeonAuthCredentials>
  ): Promise<{
    ok: boolean;
    token: string | null;
    status: AccessStatus;
    email?: string;
    full_name?: string;
    is_admin?: boolean;
    neon_user_id?: string;
    dashboard_enabled?: boolean;
    error?: string;
  }> {
    const client = getNeonAuthClient();
    if (!client) {
      return { ok: false, token: null, status: 'none', error: 'Neon Auth is not configured.' };
    }

    let jwt: string | null = neonHints?.jwt ?? null;
    let opaqueSessionToken: string | null = neonHints?.sessionToken ?? null;
    let signedSessionToken: string | null = neonHints?.signedSessionToken ?? null;

    try {
      const collected = await collectNeonAuthCredentials();
      jwt = jwt || collected.jwt;
      opaqueSessionToken = opaqueSessionToken || collected.sessionToken;
      signedSessionToken = signedSessionToken || collected.signedSessionToken;
    } catch {
      setApiAccessToken(null);
      return { ok: false, token: null, status: 'none', error: 'No active Neon Auth session.' };
    }

    const bearer = signedSessionToken || opaqueSessionToken || jwt;
    if (!bearer) {
      setApiAccessToken(null);
      return { ok: false, token: null, status: 'none', error: 'No Neon Auth session token available.' };
    }

    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/auth/neon-exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        session_token: opaqueSessionToken || undefined,
        signed_session_token: signedSessionToken || undefined,
        jwt: jwt || undefined,
        full_name: fullNameHint || '',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) {
      setApiAccessToken(null);
      return {
        ok: false,
        token: null,
        status: 'none',
        error: formatAuthApiError(
          data,
          'Could not connect your Neon sign-in to the API. Confirm Railway has NEON_AUTH_BASE_URL and migration 028 applied.',
          res.status
        ),
      };
    }

    setApiAccessToken(data.token);
    return {
      ok: true,
      token: data.token,
      status: (data.status as AccessStatus) || 'none',
      email: data.email,
      full_name: data.full_name,
      is_admin: data.is_admin,
      neon_user_id: data.neon_user_id,
      dashboard_enabled: data.dashboard_enabled,
    };
  }

  private async syncApiTokenFromNeon(fullNameHint?: string) {
    const exchange = await this.exchangeNeonSessionForApiToken(fullNameHint);
    return exchange.token;
  }

  private async fetchAccessStatus(token: string): Promise<{
    status: AccessStatus;
    email?: string;
    full_name?: string;
    is_admin?: boolean;
    neon_user_id?: string;
    dashboard_enabled?: boolean;
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
      dashboard_enabled: data.dashboard_enabled,
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
        const existingToken = getApiAccessToken();
        if (existingToken?.startsWith('ros_nsess_')) {
          const access = await this.fetchAccessStatus(existingToken);
          if (access.status !== 'none') {
            const stored = localStorage.getItem('ros_user_session');
            const parsed = stored ? JSON.parse(stored) : null;
            const storedUser = parsed?.user as User | undefined;
            const user: User = {
              id: access.neon_user_id || storedUser?.id || '',
              email: access.email || storedUser?.email || '',
              full_name: access.full_name || storedUser?.full_name || '',
              role: 'VIEWER',
              is_admin: access.is_admin,
              dashboard_enabled: access.dashboard_enabled,
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
          setApiAccessToken(null);
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
            dashboard_enabled: data.user.is_admin,
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

  async signIn(email: string, password: string, fullName?: string): Promise<{
    error: any;
    loginRateLimit?: LoginRateLimitInfo | null;
  }> {
    try {
      if (isNeonAuthEnabled) {
        const domainCheck = await this.checkDomain(email);
        if (!domainCheck.allowed) {
          return { error: { message: domainCheck.message || 'We are having trouble authorizing your account request. Please contact an administrator.' } };
        }

        const exchange = await this.neonAuthApiRequest('/api/auth/neon-login', {
          email,
          password,
          full_name: fullName || email.split('@')[0] || 'User',
        });
        if (!exchange.ok || !exchange.token) {
          return {
            error: { message: exchange.error || 'Sign in failed.' },
            loginRateLimit: exchange.loginRateLimit,
          };
        }

        const user: User = {
          id: exchange.neon_user_id || '',
          email: exchange.email || email,
          full_name: exchange.full_name || fullName || '',
          role: 'VIEWER',
          is_admin: exchange.is_admin,
          dashboard_enabled: exchange.dashboard_enabled,
          accessStatus: exchange.status,
        };

        this.authState = {
          user,
          isAuthenticated: true,
          loading: false,
          accessStatus: exchange.status,
        };
        this.persistUserSession(user, exchange.status);
        return { error: null };
      }

      const domainCheck = await this.checkDomain(email);
      if (!domainCheck.allowed) {
        return { error: { message: domainCheck.message || 'We are having trouble authorizing your account request. Please contact an administrator.' } };
      }

      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      const loginRateLimit = resolveLoginRateLimit(
        res,
        data,
        email,
        res.status === 401 || res.status === 429
      );
      if (!res.ok) {
        return {
          error: { message: data.error || 'Invalid email or password.' },
          loginRateLimit,
        };
      }

      clearLocalFailedLogin(email);
      setApiAccessToken(data.token);
      const user: User = {
        id: data.user.id,
        email: data.user.email,
        full_name: data.user.full_name || fullName || '',
        role: data.user.role || 'VIEWER',
        is_admin: data.user.is_admin,
        dashboard_enabled: data.user.is_admin,
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
    return this.requestAccess(email, fullName);
  }

  async requestAccess(
    email: string,
    fullName: string
  ): Promise<{ error: any; status?: AccessStatus; message?: string; portalUrl?: string }> {
    try {
      const domainCheck = await this.checkDomain(email);
      if (!domainCheck.allowed) {
        return { error: { message: domainCheck.message || 'We are having trouble authorizing your account request. Please contact an administrator.' } };
      }

      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/auth/request-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, full_name: fullName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          error: {
            message: data.error || data.message || 'Failed to submit access request.',
          },
        };
      }

      return {
        error: null,
        status: (data.status as AccessStatus) || 'pending',
        message: data.message,
        portalUrl: data.portalUrl,
      };
    } catch (error: any) {
      return { error: { message: error?.message || 'Failed to submit access request.' } };
    }
  }

  applySessionFromPortal(session: {
    token: string;
    email: string;
    full_name: string;
    neon_user_id: string;
    status: AccessStatus;
    is_admin?: boolean;
    dashboard_enabled?: boolean;
  }) {
    setApiAccessToken(session.token);
    const user: User = {
      id: session.neon_user_id,
      email: session.email,
      full_name: session.full_name,
      role: 'VIEWER',
      is_admin: session.is_admin,
      dashboard_enabled: session.dashboard_enabled ?? session.is_admin,
      accessStatus: session.status,
    };
    this.authState = {
      user,
      isAuthenticated: true,
      loading: false,
      accessStatus: session.status,
    };
    this.persistUserSession(user, session.status);
  }

  /** @deprecated Use requestAccess — password is set via the access portal after approval. */
  async signUpWithPassword(email: string, password: string, fullName: string): Promise<{ error: any }> {
    try {
      if (isNeonAuthEnabled) {
        const domainCheck = await this.checkDomain(email);
        if (!domainCheck.allowed) {
          return { error: { message: domainCheck.message || 'We are having trouble authorizing your account request. Please contact an administrator.' } };
        }

        const exchange = await this.neonAuthApiRequest('/api/auth/neon-register', {
          email,
          password,
          full_name: fullName,
        });
        if (!exchange.ok || !exchange.token) {
          return { error: { message: exchange.error || 'Registration failed.' } };
        }

        const user: User = {
          id: exchange.neon_user_id || '',
          email: exchange.email || email,
          full_name: exchange.full_name || fullName,
          role: 'VIEWER',
          is_admin: exchange.is_admin,
          dashboard_enabled: exchange.dashboard_enabled,
          accessStatus: exchange.status,
        };

        this.authState = {
          user,
          isAuthenticated: true,
          loading: false,
          accessStatus: exchange.status,
        };
        this.persistUserSession(user, exchange.status);
        return { error: null };
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
    if (!token.startsWith('ros_nsess_')) {
      const exchange = await this.exchangeNeonSessionForApiToken(this.authState.user?.full_name);
      if (exchange.ok) {
        this.authState.accessStatus = exchange.status;
        if (this.authState.user) {
          this.authState.user.accessStatus = exchange.status;
          this.authState.user.is_admin = exchange.is_admin;
          this.authState.user.dashboard_enabled = exchange.dashboard_enabled;
          this.persistUserSession(this.authState.user, exchange.status);
        }
        return exchange.status;
      }
      return this.authState.accessStatus;
    }
    const access = await this.fetchAccessStatus(token);
    this.authState.accessStatus = access.status;
    if (this.authState.user) {
      this.authState.user.accessStatus = access.status;
      this.authState.user.is_admin = access.is_admin;
      this.authState.user.dashboard_enabled = access.dashboard_enabled;
      this.persistUserSession(this.authState.user, access.status);
    }
    return access.status;
  }
}

export const authService = AuthService.getInstance();
export type { User, AuthState };
