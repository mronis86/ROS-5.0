import { getApiBaseUrl } from '../services/api-client';
import { adminFetch } from './adminAuth';
import {
  applyLogoVariantId,
  getLogoVariantId,
  type LogoVariantId,
} from './branding';

export type AppSettingsResponse = {
  logoVariantId: LogoVariantId;
  updatedAt: string | null;
  needsMigration?: boolean;
};

export async function fetchPublicAppSettings(): Promise<AppSettingsResponse> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/app-settings`);
  const data = (await res.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to load app settings (${res.status})`);
  }
  const logoVariantId = data.logoVariantId === 'sinor' ? 'sinor' : 'default';
  return {
    logoVariantId,
    updatedAt: data.updatedAt ?? null,
    needsMigration: data.needsMigration === true,
  };
}

export async function fetchAdminAppSettings(): Promise<AppSettingsResponse> {
  const res = await adminFetch('/api/admin/app-settings');
  const data = (await res.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to load app settings (${res.status})`);
  }
  const logoVariantId = data.logoVariantId === 'sinor' ? 'sinor' : 'default';
  return {
    logoVariantId,
    updatedAt: data.updatedAt ?? null,
    needsMigration: data.needsMigration === true,
  };
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
  const savedId = data.logoVariantId === 'sinor' ? 'sinor' : 'default';
  applyLogoVariantId(savedId);
  return {
    logoVariantId: savedId,
    updatedAt: data.updatedAt ?? null,
    needsMigration: data.needsMigration === true,
  };
}

export async function syncAdminAppSettingsTable(): Promise<AppSettingsResponse> {
  const res = await adminFetch('/api/admin/app-settings/sync-table', { method: 'POST' });
  const data = (await res.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Failed to sync app settings table (${res.status})`);
  }
  const logoVariantId = data.logoVariantId === 'sinor' ? 'sinor' : 'default';
  return {
    logoVariantId,
    updatedAt: data.updatedAt ?? null,
    needsMigration: false,
  };
}

let hydratePromise: Promise<LogoVariantId> | null = null;

/** Load the global logo variant from the API (server is source of truth). */
export async function hydrateLogoVariantFromServer(): Promise<LogoVariantId> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const settings = await fetchPublicAppSettings();
        applyLogoVariantId(settings.logoVariantId);
        return settings.logoVariantId;
      } catch {
        return getLogoVariantId();
      }
    })();
  }
  return hydratePromise;
}
