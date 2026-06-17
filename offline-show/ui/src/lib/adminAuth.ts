const ADMIN_KEY_STORAGE = 'ros_admin_key';

export function getStoredAdminKey(): string | null {
  return sessionStorage.getItem(ADMIN_KEY_STORAGE);
}

/** Gate for destructive Run-of-Show actions (e.g. clear change log). */
export function verifyClearLogPassword(password: string): boolean {
  const envPassword = import.meta.env.VITE_CLEAR_LOG_PASSWORD as string | undefined;
  if (envPassword && password === envPassword) return true;
  const adminKey = getStoredAdminKey();
  if (adminKey && password === adminKey) return true;
  return false;
}
