export const CREATIVE_DISPLAY_SESSION_PREFIX = 'ros.creative.displaySession.v1';

export type PersistedDisplaySession = {
  expiresAt: number;
  disconnected: boolean;
  durationLabel: string;
};

export function creativeDisplaySessionStorageKey(userId: string, eventId: string): string {
  return `${CREATIVE_DISPLAY_SESSION_PREFIX}:${userId}:${eventId}`;
}

export function readPersistedDisplaySession(key: string): PersistedDisplaySession | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDisplaySession;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.expiresAt !== 'number' || !Number.isFinite(parsed.expiresAt)) return null;
    return {
      expiresAt: parsed.expiresAt,
      disconnected: parsed.disconnected === true,
      durationLabel: String(parsed.durationLabel ?? ''),
    };
  } catch {
    return null;
  }
}

export function writePersistedDisplaySession(
  key: string,
  state: PersistedDisplaySession | null
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (!state) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}
