import { getApiBaseUrl } from '../services/api-client';
import type { AccessStatus } from '../services/auth-service';

export interface AccessPortalStatus {
  status: AccessStatus;
  email: string;
  full_name: string;
  is_admin: boolean;
  needs_password_setup: boolean;
  notes: string | null;
  requested_at?: string;
  reviewed_at?: string | null;
}

export interface CompleteAccountSetupResult {
  ok: boolean;
  token?: string;
  email?: string;
  full_name?: string;
  neon_user_id?: string;
  status?: AccessStatus;
  is_admin?: boolean;
  error?: string;
}

export async function fetchAccessPortalStatus(token: string): Promise<{
  ok: boolean;
  data?: AccessPortalStatus;
  error?: string;
}> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/auth/access-portal?token=${encodeURIComponent(token)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.error || 'Could not load your access status.' };
  }
  return { ok: true, data: data as AccessPortalStatus };
}

export async function completeAccountSetup(
  token: string,
  password: string
): Promise<CompleteAccountSetupResult> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/auth/complete-account-setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    return {
      ok: false,
      error: [data.error, data.hint].filter(Boolean).join(' - ') || 'Could not complete account setup.',
    };
  }
  return {
    ok: true,
    token: data.token,
    email: data.email,
    full_name: data.full_name,
    neon_user_id: data.neon_user_id,
    status: data.status,
    is_admin: data.is_admin,
  };
}
