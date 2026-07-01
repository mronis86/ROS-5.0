import { getNeonAuthClient, isNeonAuthEnabled } from './neonAuthClient';

function formatAuthError(error: unknown): string {
  if (!error) return 'Request failed.';
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const e = error as { message?: string; code?: string; status?: number };
    if (e.message) return e.message;
    if (e.code) return e.code.replace(/_/g, ' ').toLowerCase();
  }
  return 'Request failed.';
}

export function getPasswordResetRedirectUrl(): string {
  if (typeof window === 'undefined') return '/reset-password';
  return `${window.location.origin}/reset-password`;
}

export async function requestPasswordReset(email: string): Promise<{ ok: boolean; error?: string }> {
  if (!isNeonAuthEnabled) {
    return { ok: false, error: 'Password reset requires Neon Auth.' };
  }

  const client = getNeonAuthClient();
  if (!client) {
    return { ok: false, error: 'Neon Auth is not configured.' };
  }

  const normalizedEmail = email.trim();
  if (!normalizedEmail) {
    return { ok: false, error: 'Email is required.' };
  }

  try {
    const requestReset =
      typeof client.forgetPassword === 'function'
        ? client.forgetPassword.bind(client)
        : typeof client.requestPasswordReset === 'function'
          ? client.requestPasswordReset.bind(client)
          : null;

    if (!requestReset) {
      return { ok: false, error: 'Password reset is not available in this Neon Auth build.' };
    }

    const result = await requestReset({
      email: normalizedEmail,
      redirectTo: getPasswordResetRedirectUrl(),
    });

    if (result?.error) {
      return { ok: false, error: formatAuthError(result.error) };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatAuthError(err) };
  }
}

export async function resetPasswordWithToken(
  token: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isNeonAuthEnabled) {
    return { ok: false, error: 'Password reset requires Neon Auth.' };
  }

  const client = getNeonAuthClient();
  if (!client || typeof client.resetPassword !== 'function') {
    return { ok: false, error: 'Password reset is not available in this Neon Auth build.' };
  }

  try {
    const result = await client.resetPassword({
      newPassword,
      token,
    });

    if (result?.error) {
      return { ok: false, error: formatAuthError(result.error) };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatAuthError(err) };
  }
}
