const USER_ID_KEY = 'offline_user_id';
const DISPLAY_NAME_KEY = 'offline_display_name';

/** crypto.randomUUID requires a secure context — unavailable on http://192.168.x.x LAN URLs. */
function createOfflineUserId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOfflineUserId(): string {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = `offline-${createOfflineUserId()}`;
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

export function getOfflineDisplayName(): string {
  return localStorage.getItem(DISPLAY_NAME_KEY) || 'Show Operator';
}

export function setOfflineDisplayName(name: string): void {
  localStorage.setItem(DISPLAY_NAME_KEY, name.trim() || 'Show Operator');
}

export function saveOfflineRole(eventId: string, role: string): void {
  const userId = getOfflineUserId();
  localStorage.setItem(`user_role_${eventId}_${userId}`, role);
}

export function getOfflineRole(eventId: string): string | null {
  return localStorage.getItem(`user_role_${eventId}_${getOfflineUserId()}`);
}
