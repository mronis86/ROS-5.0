import type { LedOutputAnimation } from './ledOutput';

export type LedTitleSource = 'segment' | 'custom';
export type LedTextAlign = 'left' | 'center' | 'right';
export type LedFontStyle = 'normal' | 'italic';

export type LedFontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export interface LedTextStyles {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  /** Segment / custom session title */
  sessionFontFamily: string;
  sessionFontWeight: LedFontWeight;
  sessionFontStyle: LedFontStyle;
  /** Speaker name */
  nameFontFamily: string;
  nameFontWeight: LedFontWeight;
  nameFontStyle: LedFontStyle;
  /** Speaker title & organization */
  detailFontFamily: string;
  detailFontWeight: LedFontWeight;
  detailFontStyle: LedFontStyle;
  titleFontSize: number;
  nameFontSize: number;
  subtitleFontSize: number;
  titleAlign: LedTextAlign;
}

/** Position & scale for any placed element on the 4K canvas (x/y are 0–100%). */
export interface LedElementTransform {
  x: number;
  y: number;
  scale: number;
  align: LedTextAlign;
  maxWidth: number;
}

export interface LedSessionTitleConfig extends LedElementTransform {
  enabled: boolean;
  titleSource: LedTitleSource;
  customTitle: string;
  /** Multiline title shown on output. Empty = load from segment/custom source. */
  displayText: string;
}

export interface LedSpeakerPlacement extends LedElementTransform {
  id: string;
  slot: number;
  enabled: boolean;
}

export interface LedLayoutConfig {
  version: 2;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  /** 0–1 opacity for editor alignment grid lines */
  gridOpacity: number;
  sessionTitle: LedSessionTitleConfig;
  speakers: LedSpeakerPlacement[];
  styles: Partial<LedTextStyles>;
  /** Per-cue output animation. Defaults to fade when unset. */
  outputAnimation?: LedOutputAnimation;
}

export const UHD_WIDTH = 3840;
export const UHD_HEIGHT = 2160;

export type LedElementKey = 'session-title' | `speaker-${string}`;
