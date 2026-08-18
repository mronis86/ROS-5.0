import { getApiBaseUrl } from '../services/api-client';
import { adminFetch } from './adminAuth';
import {
  applyGreenRoomLayoutId,
  applyLogoVariantId,
  getGreenRoomLayoutId,
  getLogoVariantId,
  parseGreenRoomLayoutId,
  type GreenRoomLayoutId,
  type LogoVariantId,
} from './branding';

export type AppSettingsResponse = {
  logoVariantId: LogoVariantId;
  greenRoomLayoutId: GreenRoomLayoutId;
  updatedAt: string | null;
  needsMigration?: boolean;
};

function parseSettings(data: Partial<AppSettingsResponse> & { error?: string }): AppSettingsResponse {
  const logoVariantId = data.logoVariantId === 'sinor' ? 'sinor' : 'default';
  const greenRoomLayoutId = parseGreenRoomLayoutId(data.greenRoomLayoutId) ?? 'classic';
  return {
    logoVariantId,
    greenRoomLayoutId,
    updatedAt: data.updatedAt ?? null,
    needsMigration: data.needsMigration === true,
  };
}

function applySettings(settings: AppSettingsResponse): AppSettingsResponse {
  applyLogoVariantId(settings.logoVariantId);
  applyGreenRoomLayoutId(settings.greenRoomLayoutId);
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
        return getLogoVariantId();
      }
    })();
  }
  return hydratePromise;
}
