export type LedAnimationStyle =
  | 'none'
  | 'fade'
  | 'fade-up'
  | 'fade-down'
  | 'fade-left'
  | 'fade-right'
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-up'
  | 'wipe-down';

export type LedAnimationEasing =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out';

export interface LedOutputAnimation {
  style: LedAnimationStyle;
  inDurationMs: number;
  outDurationMs: number;
  inDelayMs: number;
  outDelayMs: number;
  easing: LedAnimationEasing;
  /** How far (px) slide animations travel on the 4K canvas. Higher = starts further off-screen. */
  slideDistancePx: number;
  /** When false, directional styles slide without changing opacity. */
  fadeWithMotion: boolean;
}

export type LedOutputPhase =
  | 'idle'
  | 'hold-in'
  | 'enter'
  | 'visible'
  | 'hold-out'
  | 'exit';

export type LedOutputBackgroundMode = 'transparent' | 'color';

export interface LedOutputBackground {
  mode: LedOutputBackgroundMode;
  color: string;
}

export const DEFAULT_LED_OUTPUT_BACKGROUND: LedOutputBackground = {
  mode: 'transparent',
  color: '#000000',
};
