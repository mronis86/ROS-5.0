/** Offline-safe role helpers (no Neon login stack). */
type User = {
  is_admin?: boolean;
  is_event_manager?: boolean;
  is_producer?: boolean;
  is_bts_crew?: boolean;
  is_catering?: boolean;
  is_comms?: boolean;
  is_creative?: boolean;
  dashboard_enabled?: boolean;
};

export function canAccessAdmin(user: User | null | undefined): boolean {
  return user?.is_admin === true;
}

export function canAccessAccessManager(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.is_admin) return true;
  return user.is_event_manager === true || user.is_producer === true || user.is_bts_crew === true;
}

export function canAccessPreFlightChecklist(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.is_admin) return true;
  return user.is_bts_crew === true;
}

/** Offline show laptop: Operator always allowed for local roles. */
export function canSelectOperatorRole(_user: User | null | undefined): boolean {
  return true;
}
