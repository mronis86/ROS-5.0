import type { CSSProperties } from 'react';
import type {
  LedAnimationEasing,
  LedAnimationStyle,
  LedOutputAnimation,
  LedOutputPhase,
} from '../types/ledOutput';

export const DEFAULT_LED_OUTPUT_ANIMATION: LedOutputAnimation = {
  style: 'fade',
  inDurationMs: 400,
  outDurationMs: 300,
  inDelayMs: 0,
  outDelayMs: 0,
  easing: 'ease-out',
  slideDistancePx: 96,
  fadeWithMotion: true,
};

export const LED_ANIMATION_STYLE_OPTIONS: { value: LedAnimationStyle; label: string }[] = [
  { value: 'none', label: 'None (instant)' },
  { value: 'fade', label: 'Fade' },
  { value: 'fade-up', label: 'Fade up' },
  { value: 'fade-down', label: 'Fade down' },
  { value: 'fade-left', label: 'Fade left' },
  { value: 'fade-right', label: 'Fade right' },
  { value: 'wipe-left', label: 'Wipe left' },
  { value: 'wipe-right', label: 'Wipe right' },
  { value: 'wipe-up', label: 'Wipe up' },
  { value: 'wipe-down', label: 'Wipe down' },
];

export const LED_ANIMATION_EASING_OPTIONS: { value: LedAnimationEasing; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease', label: 'Ease' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'ease-out', label: 'Ease out' },
  { value: 'ease-in-out', label: 'Ease in-out' },
];

function clampMs(value: unknown, fallback: number, max = 10000): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(max, Math.round(n));
}

function clampSlidePx(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(3840, Math.round(n));
}

export function isSlideLedAnimation(style: LedAnimationStyle): boolean {
  return (
    style === 'fade-up' ||
    style === 'fade-down' ||
    style === 'fade-left' ||
    style === 'fade-right'
  );
}

export function isWipeLedAnimation(style: LedAnimationStyle): boolean {
  return (
    style === 'wipe-left' ||
    style === 'wipe-right' ||
    style === 'wipe-up' ||
    style === 'wipe-down'
  );
}

/** Slide or wipe — shows motion-related options in the editor. */
export function isMotionLedAnimation(style: LedAnimationStyle): boolean {
  return isSlideLedAnimation(style) || isWipeLedAnimation(style);
}

/** @deprecated Use isSlideLedAnimation or isMotionLedAnimation */
export function isDirectionalLedAnimation(style: LedAnimationStyle): boolean {
  return isSlideLedAnimation(style);
}

export function parseLedOutputAnimation(raw: unknown): LedOutputAnimation {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LED_OUTPUT_ANIMATION };
  const o = raw as Partial<LedOutputAnimation>;
  const style: LedAnimationStyle = LED_ANIMATION_STYLE_OPTIONS.some((opt) => opt.value === o.style)
    ? (o.style as LedAnimationStyle)
    : DEFAULT_LED_OUTPUT_ANIMATION.style;
  const easing: LedAnimationEasing =
    LED_ANIMATION_EASING_OPTIONS.some((e) => e.value === o.easing)
      ? (o.easing as LedAnimationEasing)
      : DEFAULT_LED_OUTPUT_ANIMATION.easing;

  return {
    style,
    easing,
    inDurationMs: clampMs(o.inDurationMs, DEFAULT_LED_OUTPUT_ANIMATION.inDurationMs),
    outDurationMs: clampMs(o.outDurationMs, DEFAULT_LED_OUTPUT_ANIMATION.outDurationMs),
    inDelayMs: clampMs(o.inDelayMs, DEFAULT_LED_OUTPUT_ANIMATION.inDelayMs),
    outDelayMs: clampMs(o.outDelayMs, DEFAULT_LED_OUTPUT_ANIMATION.outDelayMs),
    slideDistancePx: clampSlidePx(o.slideDistancePx, DEFAULT_LED_OUTPUT_ANIMATION.slideDistancePx),
    fadeWithMotion:
      typeof o.fadeWithMotion === 'boolean'
        ? o.fadeWithMotion
        : DEFAULT_LED_OUTPUT_ANIMATION.fadeWithMotion,
  };
}

export function parseLedOutputFromSettings(
  settings: Record<string, unknown> | undefined | null
): LedOutputAnimation {
  return parseLedOutputAnimation(settings?.ledOutput);
}

type AnimatorStyle = CSSProperties & {
  '--led-anim-duration'?: string;
  '--led-anim-easing'?: string;
  '--led-slide-distance'?: string;
};

function animatorBaseStyle(animation: LedOutputAnimation): AnimatorStyle {
  return {
    '--led-anim-duration': `${animation.inDurationMs}ms`,
    '--led-anim-easing': animation.easing,
    '--led-slide-distance': `${animation.slideDistancePx}px`,
  };
}

const ENTER_FADE_CLASS: Record<Exclude<LedAnimationStyle, 'none'>, string> = {
  fade: 'led-output-enter-fade',
  'fade-up': 'led-output-enter-up',
  'fade-down': 'led-output-enter-down',
  'fade-left': 'led-output-enter-left',
  'fade-right': 'led-output-enter-right',
  'wipe-left': 'led-output-enter-wipe-left-fade',
  'wipe-right': 'led-output-enter-wipe-right-fade',
  'wipe-up': 'led-output-enter-wipe-up-fade',
  'wipe-down': 'led-output-enter-wipe-down-fade',
};

const EXIT_FADE_CLASS: Record<Exclude<LedAnimationStyle, 'none'>, string> = {
  fade: 'led-output-exit-fade',
  'fade-up': 'led-output-exit-up',
  'fade-down': 'led-output-exit-down',
  'fade-left': 'led-output-exit-left',
  'fade-right': 'led-output-exit-right',
  'wipe-left': 'led-output-exit-wipe-left-fade',
  'wipe-right': 'led-output-exit-wipe-right-fade',
  'wipe-up': 'led-output-exit-wipe-up-fade',
  'wipe-down': 'led-output-exit-wipe-down-fade',
};

const ENTER_SLIDE_CLASS: Partial<Record<LedAnimationStyle, string>> = {
  'fade-up': 'led-output-enter-up-slide',
  'fade-down': 'led-output-enter-down-slide',
  'fade-left': 'led-output-enter-left-slide',
  'fade-right': 'led-output-enter-right-slide',
};

const EXIT_SLIDE_CLASS: Partial<Record<LedAnimationStyle, string>> = {
  'fade-up': 'led-output-exit-up-slide',
  'fade-down': 'led-output-exit-down-slide',
  'fade-left': 'led-output-exit-left-slide',
  'fade-right': 'led-output-exit-right-slide',
};

const ENTER_WIPE_CLASS: Partial<Record<LedAnimationStyle, string>> = {
  'wipe-left': 'led-output-enter-wipe-left',
  'wipe-right': 'led-output-enter-wipe-right',
  'wipe-up': 'led-output-enter-wipe-up',
  'wipe-down': 'led-output-enter-wipe-down',
};

const EXIT_WIPE_CLASS: Partial<Record<LedAnimationStyle, string>> = {
  'wipe-left': 'led-output-exit-wipe-left',
  'wipe-right': 'led-output-exit-wipe-right',
  'wipe-up': 'led-output-exit-wipe-up',
  'wipe-down': 'led-output-exit-wipe-down',
};

function enterClass(animation: LedOutputAnimation): string {
  const { style, fadeWithMotion } = animation;
  if (style === 'fade') return ENTER_FADE_CLASS.fade;
  if (isSlideLedAnimation(style)) {
    return fadeWithMotion
      ? ENTER_FADE_CLASS[style]
      : (ENTER_SLIDE_CLASS[style] ?? ENTER_FADE_CLASS[style]);
  }
  if (isWipeLedAnimation(style)) {
    return fadeWithMotion
      ? ENTER_FADE_CLASS[style]
      : (ENTER_WIPE_CLASS[style] ?? ENTER_FADE_CLASS[style]);
  }
  return ENTER_FADE_CLASS[style];
}

function exitClass(animation: LedOutputAnimation): string {
  const { style, fadeWithMotion } = animation;
  if (style === 'fade') return EXIT_FADE_CLASS.fade;
  if (isSlideLedAnimation(style)) {
    return fadeWithMotion
      ? EXIT_FADE_CLASS[style]
      : (EXIT_SLIDE_CLASS[style] ?? EXIT_FADE_CLASS[style]);
  }
  if (isWipeLedAnimation(style)) {
    return fadeWithMotion
      ? EXIT_FADE_CLASS[style]
      : (EXIT_WIPE_CLASS[style] ?? EXIT_FADE_CLASS[style]);
  }
  return EXIT_FADE_CLASS[style];
}

export function getLedOutputAnimatorStyle(
  phase: LedOutputPhase,
  animation: LedOutputAnimation
): { className: string; style: AnimatorStyle; visible: boolean } {
  const baseStyle = animatorBaseStyle(animation);

  if (phase === 'idle' || phase === 'hold-in') {
    return { className: 'led-output-hidden', style: baseStyle, visible: false };
  }

  if (animation.style === 'none') {
    return {
      className: 'led-output-visible',
      style: baseStyle,
      visible: phase !== 'exit',
    };
  }

  if (phase === 'hold-out') {
    return { className: 'led-output-visible', style: baseStyle, visible: true };
  }

  if (phase === 'enter') {
    return {
      className: `led-output-animator ${enterClass(animation)}`,
      style: {
        ...baseStyle,
        '--led-anim-duration': `${animation.inDurationMs}ms`,
      },
      visible: true,
    };
  }

  if (phase === 'exit') {
    return {
      className: `led-output-animator ${exitClass(animation)}`,
      style: {
        ...baseStyle,
        '--led-anim-duration': `${animation.outDurationMs}ms`,
      },
      visible: true,
    };
  }

  return { className: 'led-output-visible', style: baseStyle, visible: true };
}
