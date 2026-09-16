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

export type GreenRoomLayoutId = 'classic' | 'ros';

export const GREEN_ROOM_LAYOUTS: {
  id: GreenRoomLayoutId;
  label: string;
  description: string;
}[] = [
  {
    id: 'classic',
    label: 'Classic (video)',
    description: 'Hallway TV look — portrait 9:16 with video background',
  },
  {
    id: 'ros',
    label: 'ROS',
    description: 'Same layout as Classic, with slate colors like Run of Show / Photo / Large Ops',
  },
];

export const GREEN_ROOM_LAYOUT_STORAGE_KEY = 'ros.greenRoomLayout';

let cachedGreenRoomLayoutId: GreenRoomLayoutId | null = null;

function readGreenRoomLayoutFromStorage(): GreenRoomLayoutId | null {
  try {
    const raw = localStorage.getItem(GREEN_ROOM_LAYOUT_STORAGE_KEY);
    if (raw === 'classic' || raw === 'ros') return raw;
  } catch {
    // ignore
  }
  return null;
}

export function getGreenRoomLayoutId(): GreenRoomLayoutId {
  if (cachedGreenRoomLayoutId) return cachedGreenRoomLayoutId;
  return readGreenRoomLayoutFromStorage() ?? 'classic';
}

export function applyGreenRoomLayoutId(id: GreenRoomLayoutId): void {
  cachedGreenRoomLayoutId = id;
  try {
    localStorage.setItem(GREEN_ROOM_LAYOUT_STORAGE_KEY, id);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(LOGO_VARIANT_CHANGE_EVENT, { detail: { greenRoomLayoutId: id } }));
}

export function parseGreenRoomLayoutId(value: unknown): GreenRoomLayoutId | null {
  return value === 'classic' || value === 'ros' ? value : null;
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

export const HIDE_FULLSCREEN_TIMER_STORAGE_KEY = 'ros.hideFullscreenTimerOption';
export const HIDE_FULLSCREEN_TIMER_CHANGE_EVENT = 'ros:hide-fullscreen-timer-change';

let cachedHideFullscreenTimerOption: boolean | null = null;

function readHideFullscreenTimerFromStorage(): boolean | null {
  try {
    const raw = localStorage.getItem(HIDE_FULLSCREEN_TIMER_STORAGE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    // ignore
  }
  return null;
}

export function getHideFullscreenTimerOption(): boolean {
  if (cachedHideFullscreenTimerOption != null) return cachedHideFullscreenTimerOption;
  return readHideFullscreenTimerFromStorage() ?? false;
}

export function applyHideFullscreenTimerOption(hide: boolean): void {
  cachedHideFullscreenTimerOption = !!hide;
  try {
    localStorage.setItem(HIDE_FULLSCREEN_TIMER_STORAGE_KEY, hide ? 'true' : 'false');
  } catch {
    // ignore
  }
  window.dispatchEvent(
    new CustomEvent(HIDE_FULLSCREEN_TIMER_CHANGE_EVENT, { detail: { hideFullscreenTimerOption: !!hide } })
  );
}

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
