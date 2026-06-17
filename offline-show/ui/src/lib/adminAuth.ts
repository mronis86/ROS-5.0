const ADMIN_KEY_STORAGE = 'ros_admin_key';

export function getStoredAdminKey(): string | null {
  return sessionStorage.getItem(ADMIN_KEY_STORAGE);
}

function canUseNeonAdminSession(): boolean {
  try {
    const token = localStorage.getItem('ros_api_token');
    if (!token?.startsWith('ros_nsess_')) return false;
    const stored = localStorage.getItem('ros_user_session');
    if (!stored) return false;
    const parsed = JSON.parse(stored) as { user?: { is_admin?: boolean } };
    return parsed.user?.is_admin === true;
  } catch {
    return false;
  }
}

/** Gate for destructive Run-of-Show actions (e.g. clear change log). */
export function verifyClearLogPassword(password: string): boolean {
  const envPassword = import.meta.env.VITE_CLEAR_LOG_PASSWORD as string | undefined;
  if (envPassword && password === envPassword) return true;
  if (canUseNeonAdminSession()) return true;
  const adminKey = getStoredAdminKey();
  if (adminKey && password === adminKey) return true;
  return false;
}
