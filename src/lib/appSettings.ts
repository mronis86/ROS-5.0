import { getApiBaseUrl } from '../services/api-client';
import { adminFetch } from './adminAuth';
import {
  applyCountdownColorModeId,
  applyGreenRoomLayoutId,
  applyHideFullscreenTimerOption,
  applyAutoShotTypeFromSpeakers,
  applyShowLiveSyncStatusBadge,
  applyLogoVariantId,
  getCountdownColorModeId,
  getGreenRoomLayoutId,
  getHideFullscreenTimerOption,
  getAutoShotTypeFromSpeakers,
  getShowLiveSyncStatusBadge,
  getLogoVariantId,
  parseCountdownColorModeId,
  parseGreenRoomLayoutId,
  type CountdownColorModeId,
  type GreenRoomLayoutId,
  type LogoVariantId,
} from './branding';
import {
  applyOvertimeSignId,
  getOvertimeSignId,
  parseOvertimeSignId,
  type OvertimeSignId,
} from './overtimeSign';

export type RefreshNotice = {
  version: string;
  date: string;
  seq: number;
  at?: string | null;
};

export type AppSettingsResponse = {
  logoVariantId: LogoVariantId;
  greenRoomLayoutId: GreenRoomLayoutId;
  countdownColorModeId: CountdownColorModeId;
  overtimeSignId: OvertimeSignId;
  hideFullscreenTimerOption: boolean;
  autoShotTypeFromSpeakers: boolean;
  showLiveSyncStatusBadge: boolean;
  refreshNotice: RefreshNotice | null;
  updatedAt: string | null;
  needsMigration?: boolean;
};

function parseRefreshNotice(raw: unknown): RefreshNotice | null {
  if (!raw || typeof raw !== 'object') return null;
  const version = String((raw as { version?: unknown }).version || '').trim();
  if (!version) return null;
  return {
    version,
    date: String((raw as { date?: unknown }).date || ''),
    seq: Number((raw as { seq?: unknown }).seq) || 0,
    at: (raw as { at?: string | null }).at || null,
  };
}

function parseSettings(data: Partial<AppSettingsResponse> & { error?: string }): AppSettingsResponse {
  const logoVariantId = data.logoVariantId === 'sinor' ? 'sinor' : 'default';
  const greenRoomLayoutId = parseGreenRoomLayoutId(data.greenRoomLayoutId) ?? 'classic';
  const countdownColorModeId = parseCountdownColorModeId(data.countdownColorModeId) ?? 'standard';
  const overtimeSignId = parseOvertimeSignId(data.overtimeSignId) ?? 'minus';
  return {
    logoVariantId,
    greenRoomLayoutId,
    countdownColorModeId,
    overtimeSignId,
    hideFullscreenTimerOption: data.hideFullscreenTimerOption === true,
    autoShotTypeFromSpeakers: data.autoShotTypeFromSpeakers === true,
    showLiveSyncStatusBadge: data.showLiveSyncStatusBadge === true,
    refreshNotice: parseRefreshNotice(data.refreshNotice),
    updatedAt: data.updatedAt ?? null,
    needsMigration: data.needsMigration === true,
  };
}

function applySettings(settings: AppSettingsResponse): AppSettingsResponse {
  applyLogoVariantId(settings.logoVariantId);
  applyGreenRoomLayoutId(settings.greenRoomLayoutId);
  applyCountdownColorModeId(settings.countdownColorModeId);
  applyOvertimeSignId(settings.overtimeSignId);
  applyHideFullscreenTimerOption(settings.hideFullscreenTimerOption);
  applyAutoShotTypeFromSpeakers(settings.autoShotTypeFromSpeakers);
  applyShowLiveSyncStatusBadge(settings.showLiveSyncStatusBadge);
  return settings;
}

export async function fetchPublicAppSettings(): Promise<AppSettingsResponse> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/app-settings`);
  const data = (await res.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to load app settings (${res.status})`);
  }
  return parseSettings(data);
}

export async function fetchAdminAppSettings(): Promise<AppSettingsResponse> {
  const res = await adminFetch('/api/admin/app-settings');
  const data = (await res.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to load app settings (${res.status})`);
  }
  return parseSettings(data);
}

export async function saveAdminLogoVariant(logoVariantId: LogoVariantId): Promise<AppSettingsResponse> {
  const res = await adminFetch('/api/admin/app-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ logoVariantId }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to save logo setting (${res.status})`);
  }
  return applySettings(parseSettings(data));
}

export async function saveAdminGreenRoomLayout(
  greenRoomLayoutId: GreenRoomLayoutId
): Promise<AppSettingsResponse> {
  const res = await adminFetch('/api/admin/app-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ greenRoomLayoutId }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to save Green Room layout (${res.status})`);
  }
  return applySettings(parseSettings(data));
}

export async function saveAdminCountdownColorMode(
  countdownColorModeId: CountdownColorModeId
): Promise<AppSettingsResponse> {
  const res = await adminFetch('/api/admin/app-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ countdownColorModeId }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to save countdown color (${res.status})`);
  }
  return applySettings(parseSettings(data));
}

export async function saveAdminOvertimeSign(
  overtimeSignId: OvertimeSignId
): Promise<AppSettingsResponse> {
  const res = await adminFetch('/api/admin/app-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ overtimeSignId }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to save overtime sign (${res.status})`);
  }
  const parsed = parseSettings(data);
  if (!parseOvertimeSignId(data.overtimeSignId)) {
    parsed.overtimeSignId = overtimeSignId;
  }
  return applySettings(parsed);
}

export async function saveAdminHideFullscreenTimerOption(
  hideFullscreenTimerOption: boolean
): Promise<AppSettingsResponse> {
  const res = await adminFetch('/api/admin/app-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hideFullscreenTimerOption }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to save display option (${res.status})`);
  }
  return applySettings(parseSettings(data));
}

export async function saveAdminAutoShotTypeFromSpeakers(
  autoShotTypeFromSpeakers: boolean
): Promise<AppSettingsResponse> {
  const res = await adminFetch('/api/admin/app-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoShotTypeFromSpeakers }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to save auto shot type setting (${res.status})`);
  }
  return applySettings(parseSettings(data));
}

export async function saveAdminShowLiveSyncStatusBadge(
  showLiveSyncStatusBadge: boolean
): Promise<AppSettingsResponse> {
  const res = await adminFetch('/api/admin/app-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ showLiveSyncStatusBadge }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to save live sync badge setting (${res.status})`);
  }
  return applySettings(parseSettings(data));
}

export async function saveAdminRefreshNotice(
  refreshNotice: { version: string; date?: string; seq?: number } | null
): Promise<AppSettingsResponse> {
  const res = await adminFetch('/api/admin/app-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshNotice }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to save refresh notice (${res.status})`);
  }
  return parseSettings(data);
}

export async function syncAdminAppSettingsTable(): Promise<AppSettingsResponse> {
  const res = await adminFetch('/api/admin/app-settings/sync-table', { method: 'POST' });
  const data = (await res.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to sync app settings table (${res.status})`);
  }
  return applySettings(parseSettings(data));
}

let hydratePromise: Promise<LogoVariantId> | null = null;

/** Load the global branding from the API (server is source of truth). */
export async function hydrateLogoVariantFromServer(): Promise<LogoVariantId> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const settings = await fetchPublicAppSettings();
        applySettings(settings);
        return settings.logoVariantId;
      } catch {
        applyGreenRoomLayoutId(getGreenRoomLayoutId());
        applyCountdownColorModeId(getCountdownColorModeId());
        applyOvertimeSignId(getOvertimeSignId());
        applyHideFullscreenTimerOption(getHideFullscreenTimerOption());
        applyAutoShotTypeFromSpeakers(getAutoShotTypeFromSpeakers());
        applyShowLiveSyncStatusBadge(getShowLiveSyncStatusBadge());
        return getLogoVariantId();
      }
    })();
  }
  return hydratePromise;
}
