export type LogoVariantId = 'default' | 'sinor';

export type LogoVariant = {
  id: LogoVariantId;
  label: string;
  appTitle: string;
  appTagline?: string;
  description: string;
  type: 'default' | 'image';
  /** Public URL path when type is image (file must live under public/) */
  src?: string;
};

export const LOGO_VARIANTS: LogoVariant[] = [
  {
    id: 'default',
    label: 'Run of Show (R)',
    appTitle: 'Run of Show',
    description: 'Blue R mark — current production default',
    type: 'default',
  },
  {
    id: 'sinor',
    label: 'SINOR Track',
    appTitle: 'SINOR Track',
    appTagline: 'System Independent Network Of Rundowns',
    description: 'SINOR cue-list logo',
    type: 'image',
    src: '/logos/sinor-track.png',
  },
];

export const LOGO_VARIANT_STORAGE_KEY = 'ros.logoVariant';
export const LOGO_VARIANT_CHANGE_EVENT = 'ros:branding-change';

let cachedLogoVariantId: LogoVariantId | null = null;

function readLogoVariantFromStorage(): LogoVariantId | null {
  try {
    const raw = localStorage.getItem(LOGO_VARIANT_STORAGE_KEY);
    if (raw === 'default' || raw === 'sinor') return raw;
  } catch {
    // ignore private mode / quota
  }
  return null;
}

export function getLogoVariantId(): LogoVariantId {
  if (cachedLogoVariantId) return cachedLogoVariantId;
  return readLogoVariantFromStorage() ?? 'default';
}

export function getLogoVariant(id: LogoVariantId = getLogoVariantId()): LogoVariant {
  return LOGO_VARIANTS.find((variant) => variant.id === id) ?? LOGO_VARIANTS[0];
}

export function getAppTitle(id: LogoVariantId = getLogoVariantId()): string {
  return getLogoVariant(id).appTitle;
}

export function applyLogoVariantId(id: LogoVariantId): void {
  cachedLogoVariantId = id;
  try {
    localStorage.setItem(LOGO_VARIANT_STORAGE_KEY, id);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(LOGO_VARIANT_CHANGE_EVENT, { detail: { id } }));
}

/** @deprecated Prefer applyLogoVariantId — kept for local-only callers */
export function setLogoVariantId(id: LogoVariantId): void {
  applyLogoVariantId(id);
}
