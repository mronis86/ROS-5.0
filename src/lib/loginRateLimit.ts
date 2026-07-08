export const DEFAULT_LOGIN_ATTEMPT_LIMIT = 8;
export const DEFAULT_LOGIN_WARNING_AFTER = 5;
export const DEFAULT_LOCKOUT_MINUTES = 15;

export interface LoginRateLimitInfo {
  attemptsRemaining: number;
  attemptLimit: number;
  lockoutMinutes: number;
  showWarning: boolean;
  isLockedOut: boolean;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function failedAttemptsStorageKey(email: string): string {
  return `ros_login_fail_${normalizeEmail(email)}`;
}

function readPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseRateLimitHeader(res: Response, name: string): number | null {
  const value = res.headers.get(name);
  if (!value) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export function shouldShowLoginWarning(
  attemptsRemaining: number,
  attemptLimit: number,
  warningAfter = DEFAULT_LOGIN_WARNING_AFTER
): boolean {
  if (attemptsRemaining <= 0) return false;
  const attemptsUsed = attemptLimit - attemptsRemaining;
  return attemptsUsed >= warningAfter;
}

export function parseLoginRateLimitFromResponse(
  res: Response,
  data: Record<string, unknown>
): LoginRateLimitInfo | null {
  const attemptLimit = readPositiveInt(
    data.login_attempts_limit ?? parseRateLimitHeader(res, 'RateLimit-Limit'),
    DEFAULT_LOGIN_ATTEMPT_LIMIT
  );
  const attemptsRemaining =
    data.login_attempts_remaining != null
      ? readPositiveInt(data.login_attempts_remaining, 0)
      : parseRateLimitHeader(res, 'RateLimit-Remaining');

  if (attemptsRemaining == null) return null;

  const lockoutMinutes = readPositiveInt(data.lockout_minutes, DEFAULT_LOCKOUT_MINUTES);
  const warningAfter = readPositiveInt(data.login_warning_after, DEFAULT_LOGIN_WARNING_AFTER);
  const isLockedOut = res.status === 429 || attemptsRemaining <= 0;

  return {
    attemptsRemaining: Math.max(0, attemptsRemaining),
    attemptLimit,
    lockoutMinutes,
    showWarning: !isLockedOut && shouldShowLoginWarning(attemptsRemaining, attemptLimit, warningAfter),
    isLockedOut,
  };
}

export function trackLocalFailedLogin(email: string): LoginRateLimitInfo {
  const key = failedAttemptsStorageKey(email);
  const raw = sessionStorage.getItem(key);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  const next = count + 1;
  sessionStorage.setItem(key, String(next));

  const attemptLimit = DEFAULT_LOGIN_ATTEMPT_LIMIT;
  const attemptsRemaining = Math.max(0, attemptLimit - next);

  return {
    attemptsRemaining,
    attemptLimit,
    lockoutMinutes: DEFAULT_LOCKOUT_MINUTES,
    showWarning: shouldShowLoginWarning(attemptsRemaining, attemptLimit),
    isLockedOut: attemptsRemaining <= 0,
  };
}

export function clearLocalFailedLogin(email: string): void {
  sessionStorage.removeItem(failedAttemptsStorageKey(email));
}

export function resolveLoginRateLimit(
  res: Response,
  data: Record<string, unknown>,
  email: string,
  isCredentialFailure: boolean
): LoginRateLimitInfo | null {
  if (!isCredentialFailure) return null;

  const fromServer = parseLoginRateLimitFromResponse(res, data);
  if (fromServer) return fromServer;

  if (res.status === 429) {
    return {
      attemptsRemaining: 0,
      attemptLimit: DEFAULT_LOGIN_ATTEMPT_LIMIT,
      lockoutMinutes: DEFAULT_LOCKOUT_MINUTES,
      showWarning: false,
      isLockedOut: true,
    };
  }

  if (res.status === 401) {
    return trackLocalFailedLogin(email);
  }

  return null;
}
