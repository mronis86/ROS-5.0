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

/** Slate checkerboard — preview only; canvas pixels stay transparent for keying. */
export const LED_TRANSPARENCY_GRID_BASE = '#0f172a';
export const LED_TRANSPARENCY_GRID_TILE = '#1e293b';

export function ledTransparencyGridBackgroundStyle(): Record<string, string> {
  const tile = LED_TRANSPARENCY_GRID_TILE;
  return {
    backgroundColor: LED_TRANSPARENCY_GRID_BASE,
    backgroundImage: `linear-gradient(45deg, ${tile} 25%, transparent 25%, transparent 75%, ${tile} 75%, ${tile}), linear-gradient(45deg, ${tile} 25%, transparent 25%, transparent 75%, ${tile} 75%, ${tile})`,
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0, 8px 8px',
  };
}

export function isLedOutputBroadcastKey(searchParams: URLSearchParams): boolean {
  return searchParams.get('key') === '1' || searchParams.get('broadcast') === '1';
}

/** LED output URL — always keyed for OBS / Spout (transparent or event color). */
export function buildLedOutputPageUrl(eventId: string): string {
  const id = String(eventId || '').trim();
  if (!id) return '/led-output';
  return `/led-output?eventId=${encodeURIComponent(id)}&key=1`;
}

const LED_OUTPUT_CHROME_SELECTORS = ['html', 'body', '#root', '.App'] as const;

/** Force page chrome transparent (or solid event color) — overrides global slate-900 on #root. */
export function applyLedOutputPageChrome(background: LedOutputBackground): () => void {
  const chromeBg = background.mode === 'color' ? background.color : 'transparent';

  document.documentElement.classList.add('led-output-broadcast');
  document.body.classList.add('led-output-broadcast');

  const touched: HTMLElement[] = [];
  for (const selector of LED_OUTPUT_CHROME_SELECTORS) {
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLElement)) continue;
    touched.push(el);
    el.classList.add('led-output-chrome');
    el.style.setProperty('background-color', chromeBg, 'important');
    el.style.setProperty('background-image', 'none', 'important');
  }

  return () => {
    document.documentElement.classList.remove('led-output-broadcast');
    document.body.classList.remove('led-output-broadcast');
    for (const el of touched) {
      el.classList.remove('led-output-chrome');
      el.style.removeProperty('background-color');
      el.style.removeProperty('background-image');
    }
  };
}
