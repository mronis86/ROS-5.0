export const PASSWORD_MIN_LENGTH = 15;

export const PASSWORD_REQUIREMENTS_TEXT =
  'At least 15 characters with 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.';

export function validatePasswordPolicy(password: string): { ok: true } | { ok: false; error: string } {
  const value = String(password || '');
  if (value.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (!/[A-Z]/.test(value)) {
    return { ok: false, error: 'Password must include at least one uppercase letter.' };
  }
  if (!/[a-z]/.test(value)) {
    return { ok: false, error: 'Password must include at least one lowercase letter.' };
  }
  if (!/[0-9]/.test(value)) {
    return { ok: false, error: 'Password must include at least one number.' };
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    return { ok: false, error: 'Password must include at least one special character.' };
  }
  return { ok: true };
}

export function passwordPolicyError(password: string): string | null {
  const result = validatePasswordPolicy(password);
  return result.ok ? null : result.error;
}
