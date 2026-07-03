import type { LedOutputClock } from '../types/ledClock';

export const DEFAULT_LED_OUTPUT_CLOCK: LedOutputClock = {
  enabled: false,
  visibility: 'break-only',
  label: 'Break ends in',
  showLabel: true,
  x: 50,
  y: 12,
  scale: 1,
  align: 'center',
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontWeight: 700,
  fontStyle: 'normal',
  fontSize: 160,
  color: '#ffffff',
  labelColor: '#94a3b8',
  labelFontSize: 48,
  showBackground: true,
  backgroundColor: '#000000',
  backgroundOpacity: 0.45,
  paddingPx: 32,
};

type LegacyClock = Partial<LedOutputClock> & {
  mode?: 'off' | 'wall' | 'countdown' | 'both';
};

export function parseLedOutputClock(raw: unknown): LedOutputClock {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LED_OUTPUT_CLOCK };
  const o = raw as LegacyClock;

  let enabled =
    typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_LED_OUTPUT_CLOCK.enabled;
  if (o.mode === 'off' || o.mode === 'wall') enabled = false;
  if (o.mode === 'countdown' || o.mode === 'both') {
    enabled = typeof o.enabled === 'boolean' ? o.enabled : true;
  }

  const visibility =
    o.visibility === 'always' || o.visibility === 'break-only'
      ? o.visibility
      : DEFAULT_LED_OUTPUT_CLOCK.visibility;

  return {
    enabled,
    visibility,
    label: typeof o.label === 'string' ? o.label : DEFAULT_LED_OUTPUT_CLOCK.label,
    showLabel:
      typeof o.showLabel === 'boolean' ? o.showLabel : DEFAULT_LED_OUTPUT_CLOCK.showLabel,
    x: clampNum(o.x, DEFAULT_LED_OUTPUT_CLOCK.x, 0, 100),
    y: clampNum(o.y, DEFAULT_LED_OUTPUT_CLOCK.y, 0, 100),
    scale: clampNum(o.scale, DEFAULT_LED_OUTPUT_CLOCK.scale, 0.25, 3),
    align:
      o.align === 'left' || o.align === 'center' || o.align === 'right'
        ? o.align
        : DEFAULT_LED_OUTPUT_CLOCK.align,
    fontFamily:
      typeof o.fontFamily === 'string' && o.fontFamily.trim()
        ? o.fontFamily
        : DEFAULT_LED_OUTPUT_CLOCK.fontFamily,
    fontWeight: normalizeWeight(o.fontWeight),
    fontStyle: o.fontStyle === 'italic' ? 'italic' : 'normal',
    fontSize: clampNum(o.fontSize, DEFAULT_LED_OUTPUT_CLOCK.fontSize, 24, 400),
    color: typeof o.color === 'string' ? o.color : DEFAULT_LED_OUTPUT_CLOCK.color,
    labelColor:
      typeof o.labelColor === 'string' ? o.labelColor : DEFAULT_LED_OUTPUT_CLOCK.labelColor,
    labelFontSize: clampNum(o.labelFontSize, DEFAULT_LED_OUTPUT_CLOCK.labelFontSize, 16, 120),
    showBackground:
      typeof o.showBackground === 'boolean'
        ? o.showBackground
        : DEFAULT_LED_OUTPUT_CLOCK.showBackground,
    backgroundColor:
      typeof o.backgroundColor === 'string'
        ? o.backgroundColor
        : DEFAULT_LED_OUTPUT_CLOCK.backgroundColor,
    backgroundOpacity: clampNum(
      o.backgroundOpacity,
      DEFAULT_LED_OUTPUT_CLOCK.backgroundOpacity,
      0,
      1
    ),
    paddingPx: clampNum(o.paddingPx, DEFAULT_LED_OUTPUT_CLOCK.paddingPx, 0, 120),
  };
}

export function parseLedClockFromSettings(
  settings: Record<string, unknown> | undefined | null
): LedOutputClock {
  return parseLedOutputClock(settings?.ledClock);
}

function clampNum(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeWeight(value: unknown): LedOutputClock['fontWeight'] {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (n >= 100 && n <= 900 && n % 100 === 0) return n as LedOutputClock['fontWeight'];
  return DEFAULT_LED_OUTPUT_CLOCK.fontWeight;
}

/** Countdown display — matches Run of Show / Clock (allows negative overtime). */
export function formatLedCountdown(seconds: number): string {
  const isNegative = seconds < 0;
  const absSeconds = Math.abs(seconds);
  const hours = Math.floor(absSeconds / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  const secs = Math.floor(absSeconds % 60);
  const sign = isNegative ? '-' : '';
  if (hours === 0) {
    return `${sign}${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function shouldShowLedClock(
  clock: LedOutputClock,
  cueGraphicVisible: boolean
): boolean {
  if (!clock.enabled) return false;
  if (clock.visibility === 'break-only' && cueGraphicVisible) return false;
  return true;
}
