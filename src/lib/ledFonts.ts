/** Built-in web-safe stacks for LED graphics. */
import type { LedFontStyle, LedFontWeight } from '../types/ledText';

export const LED_SYSTEM_FONTS = [
  'Arial, Helvetica, sans-serif',
  'Georgia, serif',
  '"Times New Roman", Times, serif',
  'Impact, Haettenschweiler, sans-serif',
  'Verdana, Geneva, sans-serif',
  '"Segoe UI", Tahoma, sans-serif',
] as const;

export const LED_HOSTED_FONT_GROUPS = ['GTA fonts', 'Tobias', 'Brown', 'Calluna'] as const;
export type LedHostedFontGroup = (typeof LED_HOSTED_FONT_GROUPS)[number];

export type LedCustomFont = {
  label: string;
  family: string;
  group: LedHostedFontGroup;
};

/**
 * Custom fonts loaded via src/styles/led-fonts.css (@font-face).
 * Put files in public/fonts/, add @font-face rules, then register here.
 */
export const LED_CUSTOM_FONTS: LedCustomFont[] = [
  { label: 'Regular', family: "'GTA Regular', sans-serif", group: 'GTA fonts' },
  { label: 'Light', family: "'GTA Light', sans-serif", group: 'GTA fonts' },
  { label: 'Medium', family: "'GTA Medium', sans-serif", group: 'GTA fonts' },
  { label: 'Bold', family: "'GTA Bold', sans-serif", group: 'GTA fonts' },
  { label: 'Extra Black', family: "'GTA Extra Black', sans-serif", group: 'GTA fonts' },
  { label: 'Condensed Bold', family: "'GTA Condensed Bold', sans-serif", group: 'GTA fonts' },
  { label: 'Mono', family: "'GTA Mono', monospace", group: 'GTA fonts' },
  { label: 'Tobias', family: 'Tobias, serif', group: 'Tobias' },
  { label: 'Brown Pro', family: "'Brown Pro', sans-serif", group: 'Brown' },
  { label: 'Calluna', family: 'Calluna, serif', group: 'Calluna' },
];

/** @deprecated Use LED_SYSTEM_FONTS — kept for existing imports */
export const LED_FONT_OPTIONS = [...LED_SYSTEM_FONTS];

export type LedFontOption = {
  value: string;
  label: string;
  group: 'System' | LedHostedFontGroup;
};

export function hostedFontDisplayLabel(font: LedCustomFont): string {
  if (font.group === 'GTA fonts') return `GTA ${font.label}`;
  return font.label;
}

export function fontOptionLabel(fontFamily: string): string {
  const custom = LED_CUSTOM_FONTS.find((f) => f.family === fontFamily);
  if (custom) return hostedFontDisplayLabel(custom);
  return fontFamily.split(',')[0].replace(/"/g, '').trim();
}

export function getHostedFontsByGroup(group: LedHostedFontGroup): LedFontOption[] {
  return LED_CUSTOM_FONTS.filter((f) => f.group === group).map((font) => ({
    value: font.family,
    label: font.label,
    group: font.group,
  }));
}

export function getAllLedFontOptions(): LedFontOption[] {
  const hosted = LED_HOSTED_FONT_GROUPS.flatMap((group) => getHostedFontsByGroup(group));
  const system = LED_SYSTEM_FONTS.map((family) => ({
    value: family,
    label: fontOptionLabel(family),
    group: 'System' as const,
  }));
  return [...hosted, ...system];
}

export const LED_FONT_WEIGHT_OPTIONS: { value: LedFontWeight; label: string }[] = [
  { value: 300, label: 'Light' },
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semi-bold' },
  { value: 700, label: 'Bold' },
  { value: 800, label: 'Extra-bold' },
];

export const LED_FONT_STYLE_OPTIONS: { value: LedFontStyle; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'italic', label: 'Italic' },
];

export function normalizeFontWeight(value: unknown, fallback: LedFontWeight): LedFontWeight {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (n >= 100 && n <= 900 && n % 100 === 0) return n as LedFontWeight;
  return fallback;
}

export function normalizeFontStyle(value: unknown, fallback: LedFontStyle): LedFontStyle {
  if (value === 'italic') return 'italic';
  if (value === 'normal') return 'normal';
  return fallback;
}

export function findFontGroup(
  fontFamily: string
): LedHostedFontGroup | 'System' | 'Other' {
  const custom = LED_CUSTOM_FONTS.find((f) => f.family === fontFamily);
  if (custom) return custom.group;
  if ((LED_SYSTEM_FONTS as readonly string[]).includes(fontFamily)) return 'System';
  if (fontFamily.trim()) return 'Other';
  return 'System';
}

export function getFontsForPickerGroup(
  group: LedHostedFontGroup | 'System' | 'Other'
): LedFontOption[] {
  if (group === 'System') {
    return LED_SYSTEM_FONTS.map((family) => ({
      value: family,
      label: fontOptionLabel(family),
      group: 'System' as const,
    }));
  }
  if (group === 'Other') return [];
  return getHostedFontsByGroup(group);
}

export function isKnownLedFont(fontFamily: string): boolean {
  return getAllLedFontOptions().some((o) => o.value === fontFamily);
}
