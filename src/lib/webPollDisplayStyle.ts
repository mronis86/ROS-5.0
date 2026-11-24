/**
 * Per-poll display / results styling (saved on event_web_polls.display_style).
 * Keep presets in sync with lib/web-polls.js COLOR_PRESET_COLORS.
 */

import type { WebPollType } from './webPolls';

export type ResultStyleId =
  | 'bars'
  | 'vertical'
  | 'donut'
  | 'pie'
  | 'winner'
  | 'leaderboard'
  | 'ab'
  | 'histogram';

/** @deprecated Prefer barThickness — kept for older saved styles. */
export type BarStyleId = 'fill' | 'track';

/** Largest → smallest */
export type BarThicknessId = 'xxl' | 'xl' | 'large' | 'medium' | 'regular' | 'skinny';
export type VerticalScaleId = 'tall' | 'compact';
export type SurfaceMotionId = 'off' | 'reveal' | 'grow';
export type LowerOverflowId = 'squeeze' | 'rotate';
export type PipPlacementId = 'br' | 'bl' | 'tr' | 'tl';
export type PipScaleId = 's' | 'm' | 'l' | 'xl';
export type StagePositionId = 'upper' | 'mid' | 'lower';
export type StageLayoutId = 'full' | 'split';
export type StageSplitSizeId = 'half' | 'third';
export type StageSplitSideId = 'left' | 'right';

export type ResultLook = {
  showPct: boolean;
  showCounts: boolean;
  showLabels: boolean;
  accentBars: boolean;
};

export type WebPollSurfacesStyle = {
  motion: SurfaceMotionId;
  lowerOverflow: LowerOverflowId;
  pipPlacement: PipPlacementId;
  pipScale: PipScaleId;
  /** Where the results block sits in the 16∶9 stage frame (full layout) */
  stagePosition: StagePositionId;
  /** Full-bleed plate vs left/right split panel */
  stageLayout: StageLayoutId;
  stageSplitSize: StageSplitSizeId;
  stageSplitSide: StageSplitSideId;
  /** Broadcast control: surfaces animate on when true, off when false */
  onAir: boolean;
  /** Plate fill behind chart (Stage / Lower / PiP) */
  showBackground: boolean;
  /** Plate outline */
  showBorder: boolean;
  /** Question title on each surface */
  showTitle: boolean;
};

export type WebPollDisplayStyle = {
  resultStyle: ResultStyleId;
  /** XXL → Skinny fill/track steps for stage bars */
  barThickness: BarThicknessId;
  /** Derived from barThickness for older readers (fill | track). */
  barStyle: BarStyleId;
  verticalScale: VerticalScaleId;
  look: ResultLook;
  colorPresetId: string;
  surfaces: WebPollSurfacesStyle;
};

export type ColorPresetGroup = 'various' | 'monotone';

export type ColorPreset = {
  id: string;
  label: string;
  group: ColorPresetGroup;
  colors: string[];
};

export const RESULT_STYLES: {
  id: ResultStyleId;
  label: string;
  forTypes: WebPollType[];
}[] = [
  { id: 'bars', label: 'Horizontal bars', forTypes: ['single', 'multi', 'yesno', 'ranked'] },
  { id: 'vertical', label: 'Vertical bars', forTypes: ['single', 'multi', 'yesno', 'ranked'] },
  { id: 'donut', label: 'Donut', forTypes: ['single', 'yesno'] },
  { id: 'pie', label: 'Pie', forTypes: ['single', 'yesno'] },
  { id: 'winner', label: 'Winner focus', forTypes: ['single', 'yesno', 'ranked'] },
  { id: 'leaderboard', label: 'Leaderboard race', forTypes: ['single', 'multi', 'ranked'] },
  { id: 'ab', label: 'A / B side-by-side', forTypes: ['yesno'] },
  { id: 'histogram', label: 'Rating histogram', forTypes: ['rating'] },
];

export const BAR_THICKNESS_OPTIONS: {
  id: BarThicknessId;
  label: string;
  hint: string;
}[] = [
  { id: 'xxl', label: 'XXL', hint: 'Max fill — bars share the full stage body' },
  { id: 'xl', label: 'XL', hint: 'Extra-large fill bars' },
  { id: 'large', label: 'Large', hint: 'Large fill bars' },
  { id: 'medium', label: 'Medium', hint: 'Medium fill bars' },
  { id: 'regular', label: 'Regular', hint: 'Standard fill bars' },
  { id: 'skinny', label: 'Skinny', hint: 'Label above a slim track' },
];

export const STAGE_POSITION_OPTIONS: {
  id: StagePositionId;
  label: string;
}[] = [
  { id: 'upper', label: 'Upper' },
  { id: 'mid', label: 'Mid' },
  { id: 'lower', label: 'Lower' },
];

export const STAGE_LAYOUT_OPTIONS: {
  id: StageLayoutId;
  label: string;
}[] = [
  { id: 'full', label: 'Full' },
  { id: 'split', label: 'Split' },
];

export const STAGE_SPLIT_SIZE_OPTIONS: {
  id: StageSplitSizeId;
  label: string;
}[] = [
  { id: 'third', label: '⅓' },
  { id: 'half', label: '½' },
];

export const STAGE_SPLIT_SIDE_OPTIONS: {
  id: StageSplitSideId;
  label: string;
}[] = [
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
];

export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: 'spectrum',
    label: 'Spectrum',
    group: 'various',
    colors: ['#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#fb923c', '#2dd4bf', '#94a3b8'],
  },
  {
    id: 'cool',
    label: 'Cool',
    group: 'various',
    colors: ['#22d3ee', '#38bdf8', '#818cf8', '#a78bfa', '#67e8f9', '#60a5fa', '#c4b5fd', '#5eead4'],
  },
  {
    id: 'warm',
    label: 'Warm',
    group: 'various',
    colors: ['#f87171', '#fb923c', '#fbbf24', '#f472b6', '#ef4444', '#f59e0b', '#e11d48', '#fdba74'],
  },
  {
    id: 'neon',
    label: 'Neon',
    group: 'various',
    colors: ['#22d3ee', '#a3e635', '#e879f9', '#facc15', '#fb7185', '#4ade80', '#38bdf8', '#f97316'],
  },
  {
    id: 'pastel',
    label: 'Pastel',
    group: 'various',
    colors: ['#7dd3fc', '#c4b5fd', '#86efac', '#fda4af', '#fde68a', '#fdba74', '#5eead4', '#cbd5e1'],
  },
  {
    id: 'mono-amber',
    label: 'Amber',
    group: 'monotone',
    colors: ['#fef3c7', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e'],
  },
  {
    id: 'mono-sky',
    label: 'Sky',
    group: 'monotone',
    colors: ['#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985'],
  },
  {
    id: 'mono-violet',
    label: 'Violet',
    group: 'monotone',
    colors: ['#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6'],
  },
  {
    id: 'mono-emerald',
    label: 'Emerald',
    group: 'monotone',
    colors: ['#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857', '#065f46'],
  },
  {
    id: 'mono-rose',
    label: 'Rose',
    group: 'monotone',
    colors: ['#ffe4e6', '#fecdd3', '#fda4af', '#fb7185', '#f43f5e', '#e11d48', '#be123c', '#9f1239'],
  },
  {
    id: 'mono-slate',
    label: 'Slate',
    group: 'monotone',
    colors: ['#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b'],
  },
];

export const DEFAULT_DISPLAY_STYLE: WebPollDisplayStyle = {
  resultStyle: 'bars',
  barThickness: 'regular',
  barStyle: 'fill',
  verticalScale: 'tall',
  look: {
    showPct: true,
    showCounts: true,
    showLabels: true,
    accentBars: true,
  },
  colorPresetId: 'spectrum',
  surfaces: {
    motion: 'grow',
    lowerOverflow: 'squeeze',
    pipPlacement: 'br',
    pipScale: 'l',
    stagePosition: 'mid',
    stageLayout: 'full',
    stageSplitSize: 'half',
    stageSplitSide: 'right',
    onAir: false,
    showBackground: true,
    showBorder: true,
    showTitle: true,
  },
};

export function getColorPreset(id: string): ColorPreset {
  return COLOR_PRESETS.find((p) => p.id === id) || COLOR_PRESETS[0];
}

export function stylesForPollType(pollType: WebPollType) {
  return RESULT_STYLES.filter((s) => s.forTypes.includes(pollType));
}

export function barStyleFromThickness(thickness: BarThicknessId): BarStyleId {
  return thickness === 'skinny' ? 'track' : 'fill';
}

/** How much of the stage body the bar stack occupies (samples XXL ≈ 100%). */
export function stageBandHeightPct(thickness: BarThicknessId): number {
  switch (thickness) {
    case 'xxl':
      return 100;
    case 'xl':
      return 92;
    case 'large':
      return 82;
    case 'medium':
      return 72;
    case 'regular':
      return 62;
    case 'skinny':
      return 54;
    default:
      return 62;
  }
}

export function stageBandGapPct(thickness: BarThicknessId): number {
  switch (thickness) {
    case 'xxl':
      return 1.6;
    case 'xl':
      return 2;
    case 'large':
      return 2.4;
    case 'medium':
      return 3;
    case 'regular':
      return 3.5;
    case 'skinny':
      return 4.5;
    default:
      return 3.5;
  }
}

/** How wide a vertical fill sits inside its equal column (mirrors horizontal weight). */
export function verticalBarWidthPct(thickness: BarThicknessId): number {
  switch (thickness) {
    case 'xxl':
      return 100;
    case 'xl':
      return 86;
    case 'large':
      return 74;
    case 'medium':
      return 62;
    case 'regular':
      return 52;
    case 'skinny':
      return 28;
    default:
      return 52;
  }
}

/** Control / results mini row height in px. */
export function controlBarHeightPx(thickness: BarThicknessId): number {
  switch (thickness) {
    case 'xxl':
      return 52;
    case 'xl':
      return 44;
    case 'large':
      return 38;
    case 'medium':
      return 32;
    case 'regular':
      return 26;
    case 'skinny':
      return 6;
    default:
      return 26;
  }
}

const BAR_THICKNESS_SET = new Set<string>(BAR_THICKNESS_OPTIONS.map((o) => o.id));

/** Map retired ids → current scale. */
const LEGACY_THICKNESS: Record<string, BarThicknessId> = {
  fat: 'xl',
  thick: 'medium',
  thin: 'skinny',
};

export function resolveBarThickness(raw: unknown, legacyBarStyle?: unknown): BarThicknessId {
  const t = String(raw || '')
    .trim()
    .toLowerCase();
  if (BAR_THICKNESS_SET.has(t)) return t as BarThicknessId;
  if (LEGACY_THICKNESS[t]) return LEGACY_THICKNESS[t];
  const legacy = String(legacyBarStyle || '')
    .trim()
    .toLowerCase();
  if (legacy === 'track') return 'skinny';
  if (legacy === 'fill') return 'regular';
  return DEFAULT_DISPLAY_STYLE.barThickness;
}

export function normalizeWebPollDisplayStyle(
  raw: unknown,
  pollType?: WebPollType | string | null
): WebPollDisplayStyle {
  const src =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const lookSrc =
    src.look && typeof src.look === 'object'
      ? (src.look as Record<string, unknown>)
      : {};
  const surfSrc =
    src.surfaces && typeof src.surfaces === 'object'
      ? (src.surfaces as Record<string, unknown>)
      : {};

  const type = String(pollType || '').toLowerCase() as WebPollType | '';
  const allowed = type ? stylesForPollType(type as WebPollType) : RESULT_STYLES;
  let resultStyle = String(src.resultStyle || src.result_style || DEFAULT_DISPLAY_STYLE.resultStyle)
    .trim()
    .toLowerCase() as ResultStyleId;
  if (!allowed.some((s) => s.id === resultStyle)) {
    resultStyle = (allowed[0]?.id || DEFAULT_DISPLAY_STYLE.resultStyle) as ResultStyleId;
  }

  const barThickness = resolveBarThickness(
    src.barThickness ?? src.bar_thickness,
    src.barStyle ?? src.bar_style
  );
  const barStyle = barStyleFromThickness(barThickness);

  const scaleRaw = String(
    src.verticalScale || src.vertical_scale || DEFAULT_DISPLAY_STYLE.verticalScale
  ).toLowerCase();
  const verticalScale: VerticalScaleId = scaleRaw === 'compact' ? 'compact' : 'tall';

  let colorPresetId = String(
    src.colorPresetId || src.color_preset_id || DEFAULT_DISPLAY_STYLE.colorPresetId
  ).trim();
  if (!COLOR_PRESETS.some((p) => p.id === colorPresetId)) {
    colorPresetId = DEFAULT_DISPLAY_STYLE.colorPresetId;
  }

  const motionRaw = String(surfSrc.motion || DEFAULT_DISPLAY_STYLE.surfaces.motion).toLowerCase();
  const motion: SurfaceMotionId =
    motionRaw === 'off' || motionRaw === 'reveal' || motionRaw === 'grow'
      ? motionRaw
      : DEFAULT_DISPLAY_STYLE.surfaces.motion;

  const overflowRaw = String(
    surfSrc.lowerOverflow || surfSrc.lower_overflow || DEFAULT_DISPLAY_STYLE.surfaces.lowerOverflow
  ).toLowerCase();
  const lowerOverflow: LowerOverflowId = overflowRaw === 'rotate' ? 'rotate' : 'squeeze';

  const pipRaw = String(
    surfSrc.pipPlacement || surfSrc.pip_placement || DEFAULT_DISPLAY_STYLE.surfaces.pipPlacement
  ).toLowerCase();
  const pipPlacement: PipPlacementId =
    pipRaw === 'bl' || pipRaw === 'tr' || pipRaw === 'tl' || pipRaw === 'br'
      ? pipRaw
      : DEFAULT_DISPLAY_STYLE.surfaces.pipPlacement;

  const pipScaleRaw = String(
    surfSrc.pipScale || surfSrc.pip_scale || DEFAULT_DISPLAY_STYLE.surfaces.pipScale
  ).toLowerCase();
  const pipScale: PipScaleId =
    pipScaleRaw === 's' || pipScaleRaw === 'm' || pipScaleRaw === 'l' || pipScaleRaw === 'xl'
      ? pipScaleRaw
      : DEFAULT_DISPLAY_STYLE.surfaces.pipScale;

  const stageRaw = String(
    surfSrc.stagePosition || surfSrc.stage_position || DEFAULT_DISPLAY_STYLE.surfaces.stagePosition
  ).toLowerCase();
  const stagePosition: StagePositionId =
    stageRaw === 'upper' || stageRaw === 'mid' || stageRaw === 'lower'
      ? stageRaw
      : DEFAULT_DISPLAY_STYLE.surfaces.stagePosition;

  const layoutRaw = String(
    surfSrc.stageLayout || surfSrc.stage_layout || DEFAULT_DISPLAY_STYLE.surfaces.stageLayout
  ).toLowerCase();
  const stageLayout: StageLayoutId = layoutRaw === 'split' ? 'split' : 'full';

  const splitSizeRaw = String(
    surfSrc.stageSplitSize ||
      surfSrc.stage_split_size ||
      DEFAULT_DISPLAY_STYLE.surfaces.stageSplitSize
  ).toLowerCase();
  const stageSplitSize: StageSplitSizeId =
    splitSizeRaw === 'third' ? 'third' : 'half';

  const splitSideRaw = String(
    surfSrc.stageSplitSide ||
      surfSrc.stage_split_side ||
      DEFAULT_DISPLAY_STYLE.surfaces.stageSplitSide
  ).toLowerCase();
  const stageSplitSide: StageSplitSideId =
    splitSideRaw === 'left' ? 'left' : 'right';

  const onAirRaw = surfSrc.onAir ?? surfSrc.on_air;
  const onAir =
    onAirRaw === true ||
    onAirRaw === 1 ||
    String(onAirRaw || '').toLowerCase() === 'true';

  const showBackground =
    surfSrc.showBackground !== false &&
    surfSrc.show_background !== false;
  const showBorder =
    surfSrc.showBorder !== false && surfSrc.show_border !== false;
  const showTitle =
    surfSrc.showTitle !== false && surfSrc.show_title !== false;

  return {
    resultStyle,
    barThickness,
    barStyle,
    verticalScale,
    look: {
      showPct: lookSrc.showPct !== false && lookSrc.show_pct !== false,
      showCounts: lookSrc.showCounts !== false && lookSrc.show_counts !== false,
      showLabels: lookSrc.showLabels !== false && lookSrc.show_labels !== false,
      accentBars: lookSrc.accentBars !== false && lookSrc.accent_bars !== false,
    },
    colorPresetId,
    surfaces: {
      motion,
      lowerOverflow,
      pipPlacement,
      pipScale,
      stagePosition,
      stageLayout,
      stageSplitSize,
      stageSplitSide,
      onAir,
      showBackground,
      showBorder,
      showTitle,
    },
  };
}
