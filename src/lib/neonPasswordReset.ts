import { getNeonAuthBaseUrl, isNeonAuthEnabled } from './neonAuthClient';

function formatAuthError(error: unknown, body?: { message?: string; code?: string }): string {
  const code = body?.code || (typeof error === 'object' && error && 'code' in error ? String((error as { code?: string }).code) : '');
  const message =
    body?.message ||
    (typeof error === 'object' && error && 'message' in error ? String((error as { message?: string }).message) : '') ||
    (typeof error === 'string' ? error : '');

  if (code === 'feature_not_supported' || /invalid redirecturl/i.test(message)) {
    return 'Add this site URL in Neon Console → Auth → Configuration → Domains (e.g. http://localhost:3003 for local dev).';
  }
  if (/reset password isn't enabled/i.test(message)) {
    return 'Password reset email is not enabled in Neon Auth. Configure email in Neon Console → Auth.';
  }
  if (message) return message;
  if (code) return code.replace(/_/g, ' ').toLowerCase();
  return 'Request failed.';
}

export function getPasswordResetRedirectUrl(): string {
  if (typeof window === 'undefined') return '/reset-password';
  return `${window.location.origin}/reset-password`;
}

async function neonAuthPost(path: string, body: Record<string, unknown>) {
  const base = getNeonAuthBaseUrl();
  if (!base) {
    return { ok: false as const, status: 503, error: 'Neon Auth is not configured.' };
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false as const,
      status: 0,
      error: err instanceof Error ? err.message : 'Could not reach Neon Auth.',
    };
  }

  const data = (await res.json().catch(() => ({}))) as { message?: string; code?: string; status?: boolean };
  if (!res.ok) {
    return {
      ok: false as const,
      status: res.status,
      error: formatAuthError(null, data),
    };
  }

  return { ok: true as const, status: res.status, data };
}

export async function requestPasswordReset(email: string): Promise<{ ok: boolean; error?: string }> {
  if (!isNeonAuthEnabled) {
    return { ok: false, error: 'Password reset requires Neon Auth.' };
  }

  const normalizedEmail = email.trim();
  if (!normalizedEmail) {
    return { ok: false, error: 'Email is required.' };
  }

  const result = await neonAuthPost('/request-password-reset', {
    email: normalizedEmail,
    redirectTo: getPasswordResetRedirectUrl(),
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true };
}

export async function resetPasswordWithToken(
  token: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isNeonAuthEnabled) {
    return { ok: false, error: 'Password reset requires Neon Auth.' };
  }

  const result = await neonAuthPost('/reset-password', {
    newPassword,
    token,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true };
}
