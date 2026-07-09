import type { LedOutputBackground, LedOutputBackgroundMode } from '../types/ledOutput';
import { DEFAULT_LED_OUTPUT_BACKGROUND } from '../types/ledOutput';

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

export function parseLedOutputBackground(raw: unknown): LedOutputBackground {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LED_OUTPUT_BACKGROUND };
  const o = raw as Partial<LedOutputBackground>;
  const mode: LedOutputBackgroundMode = o.mode === 'color' ? 'color' : 'transparent';
  return {
    mode,
    color: normalizeHexColor(o.color, DEFAULT_LED_OUTPUT_BACKGROUND.color),
  };
}

export function parseLedOutputBackgroundFromSettings(
  settings: Record<string, unknown> | undefined | null
): LedOutputBackground {
  return parseLedOutputBackground(settings?.ledOutputBackground);
}

export function resolveLedCanvasBackground(background: LedOutputBackground): string {
  return background.mode === 'color' ? background.color : 'transparent';
}
