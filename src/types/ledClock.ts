import type { LedFontStyle, LedFontWeight, LedTextAlign } from './ledText';

/** `break-only` = show when cue graphics are cleared (audience break). */
export type LedClockVisibility = 'always' | 'break-only';

export interface LedOutputClock {
  enabled: boolean;
  visibility: LedClockVisibility;
  /** Shown above countdown, e.g. "Break ends in" */
  label: string;
  showLabel: boolean;
  x: number;
  y: number;
  scale: number;
  align: LedTextAlign;
  fontFamily: string;
  fontWeight: LedFontWeight;
  fontStyle: LedFontStyle;
  fontSize: number;
  color: string;
  labelColor: string;
  labelFontSize: number;
  showBackground: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
  paddingPx: number;
}
