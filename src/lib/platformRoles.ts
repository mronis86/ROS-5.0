/** Platform access roles (api_user_access flags). Crew maps to is_bts_crew. */

export type PlatformRoleId =
  | 'admin'
  | 'event_manager'
  | 'comms'
  | 'catering'
  | 'creative'
  | 'crew'
  | 'user';

export type PlatformRoleFlags = {
  is_admin: boolean;
  is_event_manager: boolean;
  is_catering: boolean;
  is_bts_crew: boolean;
  is_comms: boolean;
  is_creative: boolean;
};

export const PLATFORM_ROLE_OPTIONS: Array<{
  id: PlatformRoleId;
  label: string;
  description: string;
}> = [
  { id: 'admin', label: 'Admin', description: 'Full admin access' },
  { id: 'event_manager', label: 'Event Manager', description: 'Access Manager + event ops' },
  { id: 'comms', label: 'Comms', description: 'Comms event list / recording marks' },
  { id: 'catering', label: 'Catering', description: 'Catering event list' },
  { id: 'creative', label: 'Creative', description: 'Content review + read-only run of show' },
  { id: 'crew', label: 'Crew', description: 'BTS crew — EM-level + Pre-Flight' },
  { id: 'user', label: 'User', description: 'Standard approved account' },
];

export function platformRoleFromFlags(flags: {
  is_admin?: boolean;
  is_event_manager?: boolean;
  is_catering?: boolean;
  is_bts_crew?: boolean;
  is_comms?: boolean;
  is_creative?: boolean;
}): PlatformRoleId {
  if (flags.is_admin) return 'admin';
  if (flags.is_bts_crew) return 'crew';
  if (flags.is_event_manager) return 'event_manager';
  if (flags.is_catering) return 'catering';
  if (flags.is_comms) return 'comms';
  if (flags.is_creative) return 'creative';
  return 'user';
}

export function platformRoleLabel(role: PlatformRoleId): string {
  return PLATFORM_ROLE_OPTIONS.find((o) => o.id === role)?.label || 'User';
}

export function flagsForPlatformRole(role: PlatformRoleId): PlatformRoleFlags {
  return {
    is_admin: role === 'admin',
    is_event_manager: role === 'event_manager',
    is_catering: role === 'catering',
    is_bts_crew: role === 'crew',
    is_comms: role === 'comms',
    is_creative: role === 'creative',
  };
}
