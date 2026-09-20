export type LogoVariantId = 'default' | 'sinor';

export type LogoVariant = {
  id: LogoVariantId;
  label: string;
  appTitle: string;
  appTagline?: string;
  description: string;
  type: 'default' | 'image';
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

export function getLogoVariantId(): LogoVariantId {
  try {
    const raw = localStorage.getItem(LOGO_VARIANT_STORAGE_KEY);
    if (raw === 'default' || raw === 'sinor') return raw;
  } catch {
    // ignore
  }
  return 'default';
}

export function getLogoVariant(id: LogoVariantId = getLogoVariantId()): LogoVariant {
  return LOGO_VARIANTS.find((variant) => variant.id === id) ?? LOGO_VARIANTS[0];
}

export function getAppTitle(id: LogoVariantId = getLogoVariantId()): string {
  return getLogoVariant(id).appTitle;
}

export function setLogoVariantId(id: LogoVariantId): void {
  try {
    localStorage.setItem(LOGO_VARIANT_STORAGE_KEY, id);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(LOGO_VARIANT_CHANGE_EVENT, { detail: { id } }));
}

export type CountdownColorModeId = 'standard' | 'white' | 'bolderGreen';

export const COUNTDOWN_COLOR_MODES: {
  id: CountdownColorModeId;
  label: string;
  description: string;
  previewHex: string;
}[] = [
  {
    id: 'standard',
    label: 'Standard',
    description: 'Current emerald green when plenty of time remains',
    previewHex: '#10b981',
  },
  {
    id: 'white',
    label: 'White',
    description: 'High-contrast white primary countdown (warnings stay amber/red)',
    previewHex: '#ffffff',
  },
  {
    id: 'bolderGreen',
    label: 'Bolder Green',
    description: 'Neon lime-green — clearly brighter than Standard on dark stage screens',
    previewHex: '#39FF14',
  },
];

export const COUNTDOWN_COLOR_MODE_STORAGE_KEY = 'ros.countdownColorMode';
export const COUNTDOWN_COLOR_CHANGE_EVENT = 'ros:countdown-color-change';

let cachedCountdownColorModeId: CountdownColorModeId | null = null;

function readCountdownColorModeFromStorage(): CountdownColorModeId | null {
  try {
    const raw = localStorage.getItem(COUNTDOWN_COLOR_MODE_STORAGE_KEY);
    if (raw === 'standard' || raw === 'white' || raw === 'bolderGreen') return raw;
  } catch {
    // ignore
  }
  return null;
}

export function parseCountdownColorModeId(value: unknown): CountdownColorModeId | null {
  return value === 'standard' || value === 'white' || value === 'bolderGreen' ? value : null;
}

export function getCountdownColorModeId(): CountdownColorModeId {
  if (cachedCountdownColorModeId) return cachedCountdownColorModeId;
  return readCountdownColorModeFromStorage() ?? 'standard';
}

export function getCountdownPrimaryHex(mode: CountdownColorModeId = getCountdownColorModeId()): string {
  const found = COUNTDOWN_COLOR_MODES.find((m) => m.id === mode);
  return found?.previewHex ?? '#10b981';
}

export function applyCountdownColorModeId(id: CountdownColorModeId): void {
  cachedCountdownColorModeId = id;
  try {
    localStorage.setItem(COUNTDOWN_COLOR_MODE_STORAGE_KEY, id);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(COUNTDOWN_COLOR_CHANGE_EVENT, { detail: { countdownColorModeId: id } }));
  window.dispatchEvent(new CustomEvent(LOGO_VARIANT_CHANGE_EVENT, { detail: { countdownColorModeId: id } }));
}
