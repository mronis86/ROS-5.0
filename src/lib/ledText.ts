import type { CSSProperties } from 'react';
import { getSpeakerForSlot, parseSpeakers, type ParsedSpeaker } from '../showcase/photoShowcaseHelpers';
import type {
  LedElementTransform,
  LedLayoutConfig,
  LedSessionTitleConfig,
  LedSpeakerPlacement,
  LedTextStyles,
  LedTitleSource,
} from '../types/ledText';
import type { LedOutputAnimation } from '../types/ledOutput';
import { UHD_HEIGHT, UHD_WIDTH } from '../types/ledText';

import { normalizeFontStyle, normalizeFontWeight } from './ledFonts';
import { parseLedOutputAnimation, DEFAULT_LED_OUTPUT_ANIMATION } from './ledOutputAnimation';

export const DEFAULT_LED_STYLES: LedTextStyles = {
  primaryColor: '#ffffff',
  accentColor: '#60a5fa',
  backgroundColor: 'transparent',
  sessionFontFamily: 'Arial, Helvetica, sans-serif',
  sessionFontWeight: 700,
  sessionFontStyle: 'normal',
  nameFontFamily: 'Arial, Helvetica, sans-serif',
  nameFontWeight: 700,
  nameFontStyle: 'normal',
  detailFontFamily: 'Arial, Helvetica, sans-serif',
  detailFontWeight: 400,
  detailFontStyle: 'normal',
  titleFontSize: 180,
  nameFontSize: 120,
  subtitleFontSize: 52,
  titleAlign: 'left',
};

const DEFAULT_TRANSFORM: LedElementTransform = {
  x: 4,
  y: 4,
  scale: 1,
  align: 'left',
  maxWidth: 90,
};

export const DEFAULT_SESSION_TITLE: LedSessionTitleConfig = {
  enabled: true,
  titleSource: 'segment',
  customTitle: '',
  displayText: '',
  x: 4,
  y: 4,
  scale: 1,
  align: 'left',
  maxWidth: 92,
};

export function createSpeakerPlacement(slot: number, x = 4, y = 72): LedSpeakerPlacement {
  return {
    id: `sp-${slot}`,
    slot,
    enabled: true,
    x,
    y,
    scale: 1,
    align: 'left',
    maxWidth: 44,
  };
}

export const DEFAULT_LED_LAYOUT: LedLayoutConfig = {
  version: 2,
  showGrid: true,
  snapToGrid: true,
  gridSize: 80,
  gridOpacity: 0.35,
  sessionTitle: { ...DEFAULT_SESSION_TITLE },
  speakers: [createSpeakerPlacement(1, 4, 72)],
  styles: {},
};

const LED_LAYOUT_KEY = 'ledLayout';

type LegacyTemplate =
  | 'none'
  | 'session-title'
  | 'single-speaker'
  | 'dual-speaker'
  | 'session-plus-speaker'
  | 'panel-4';

function isV2Layout(raw: Record<string, unknown>): raw is LedLayoutConfig {
  return raw.version === 2;
}

function migrateLegacyTemplate(
  template: LegacyTemplate,
  titleSource: LedTitleSource,
  customTitle: string,
  speakerSlots: number[],
  styles: Partial<LedTextStyles>
): LedLayoutConfig {
  const base: LedLayoutConfig = {
    version: 2,
    showGrid: true,
    snapToGrid: true,
    gridSize: 80,
    gridOpacity: 0.35,
    sessionTitle: {
      ...DEFAULT_SESSION_TITLE,
      enabled: template !== 'none',
      titleSource,
      customTitle,
      x: 4,
      y: 4,
    },
    speakers: [],
    styles,
  };

  if (template === 'none' || template === 'session-title') {
    return base;
  }

  const slots =
    speakerSlots.length > 0
      ? speakerSlots
      : template === 'dual-speaker'
        ? [1, 2]
        : template === 'panel-4'
          ? [1, 2, 3, 4]
          : [1];

  if (template === 'single-speaker' || template === 'session-plus-speaker') {
    base.speakers = [createSpeakerPlacement(slots[0] ?? 1, 4, 72)];
  } else if (template === 'dual-speaker') {
    base.speakers = [
      createSpeakerPlacement(slots[0] ?? 1, 4, 72),
      createSpeakerPlacement(slots[1] ?? 2, 52, 72),
    ];
  } else if (template === 'panel-4') {
    base.speakers = [
      createSpeakerPlacement(slots[0] ?? 1, 4, 58),
      createSpeakerPlacement(slots[1] ?? 2, 52, 58),
      createSpeakerPlacement(slots[2] ?? 3, 4, 78),
      createSpeakerPlacement(slots[3] ?? 4, 52, 78),
    ];
  }

  return base;
}

function clampPercent(n: number): number {
  return Math.min(100, Math.max(0, n));
}

function normalizeTransform(t: Partial<LedElementTransform> | undefined, fallback: LedElementTransform): LedElementTransform {
  return {
    x: clampPercent(typeof t?.x === 'number' ? t.x : fallback.x),
    y: clampPercent(typeof t?.y === 'number' ? t.y : fallback.y),
    scale: typeof t?.scale === 'number' ? Math.min(3, Math.max(0.25, t.scale)) : fallback.scale,
    align: t?.align === 'center' || t?.align === 'right' ? t.align : fallback.align,
    maxWidth: typeof t?.maxWidth === 'number' ? Math.min(100, Math.max(10, t.maxWidth)) : fallback.maxWidth,
  };
}

export function normalizeLedLayout(raw: Partial<LedLayoutConfig>): LedLayoutConfig {
  const session = raw.sessionTitle ?? DEFAULT_SESSION_TITLE;
  return {
    version: 2,
    showGrid: raw.showGrid !== false,
    snapToGrid: raw.snapToGrid !== false,
    gridSize: typeof raw.gridSize === 'number' ? Math.max(20, Math.min(400, raw.gridSize)) : 80,
    gridOpacity:
      typeof raw.gridOpacity === 'number'
        ? Math.min(1, Math.max(0.05, raw.gridOpacity))
        : 0.35,
    sessionTitle: {
      enabled: session.enabled !== false,
      titleSource: session.titleSource === 'custom' ? 'custom' : 'segment',
      customTitle: typeof session.customTitle === 'string' ? session.customTitle : '',
      displayText: typeof session.displayText === 'string' ? session.displayText : '',
      ...normalizeTransform(session, DEFAULT_SESSION_TITLE),
    },
    speakers: Array.isArray(raw.speakers)
      ? raw.speakers
          .filter((s) => s && typeof s.slot === 'number' && s.slot >= 1 && s.slot <= 7)
          .map((s) => ({
            id: typeof s.id === 'string' ? s.id : `sp-${s.slot}`,
            slot: s.slot,
            enabled: s.enabled !== false,
            ...normalizeTransform(s, { ...DEFAULT_TRANSFORM, y: 72, maxWidth: 44 }),
          }))
      : [...DEFAULT_LED_LAYOUT.speakers],
    styles: raw.styles && typeof raw.styles === 'object' ? raw.styles : {},
    ...(raw.outputAnimation != null
      ? { outputAnimation: parseLedOutputAnimation(raw.outputAnimation) }
      : {}),
  };
}

export function parseLedLayout(raw: unknown): LedLayoutConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LED_LAYOUT };
  const o = raw as Record<string, unknown>;

  if (isV2Layout(o as LedLayoutConfig)) {
    return normalizeLedLayout(o as LedLayoutConfig);
  }

  const template = (o.template as LegacyTemplate) || 'single-speaker';
  const titleSource = (o.titleSource as LedTitleSource) || 'segment';
  const customTitle = typeof o.customTitle === 'string' ? o.customTitle : '';
  const speakerSlots = Array.isArray(o.speakerSlots)
    ? o.speakerSlots.filter((n): n is number => typeof n === 'number' && n >= 1 && n <= 7)
    : [1];
  const styles = o.styles && typeof o.styles === 'object' ? (o.styles as Partial<LedTextStyles>) : {};

  return normalizeLedLayout(migrateLegacyTemplate(template, titleSource, customTitle, speakerSlots, styles));
}

export function getLedLayoutFromItem(item: { customFields?: Record<string, unknown> }): LedLayoutConfig {
  return parseLedLayout(item.customFields?.[LED_LAYOUT_KEY]);
}

export function mergeLedStyles(
  partial?: Partial<LedTextStyles> & { fontFamily?: string }
): LedTextStyles {
  const legacyFont =
    typeof partial?.fontFamily === 'string' && partial.fontFamily.trim()
      ? partial.fontFamily.trim()
      : undefined;

  const sessionFontFamily =
    partial?.sessionFontFamily?.trim() || legacyFont || DEFAULT_LED_STYLES.sessionFontFamily;
  const nameFontFamily =
    partial?.nameFontFamily?.trim() || legacyFont || DEFAULT_LED_STYLES.nameFontFamily;
  const detailFontFamily =
    partial?.detailFontFamily?.trim() || legacyFont || DEFAULT_LED_STYLES.detailFontFamily;

  return {
    ...DEFAULT_LED_STYLES,
    ...partial,
    sessionFontFamily,
    nameFontFamily,
    detailFontFamily,
    sessionFontWeight: normalizeFontWeight(partial?.sessionFontWeight, DEFAULT_LED_STYLES.sessionFontWeight),
    nameFontWeight: normalizeFontWeight(partial?.nameFontWeight, DEFAULT_LED_STYLES.nameFontWeight),
    detailFontWeight: normalizeFontWeight(partial?.detailFontWeight, DEFAULT_LED_STYLES.detailFontWeight),
    sessionFontStyle: normalizeFontStyle(partial?.sessionFontStyle, DEFAULT_LED_STYLES.sessionFontStyle),
    nameFontStyle: normalizeFontStyle(partial?.nameFontStyle, DEFAULT_LED_STYLES.nameFontStyle),
    detailFontStyle: normalizeFontStyle(partial?.detailFontStyle, DEFAULT_LED_STYLES.detailFontStyle),
  };
}

export function getTitleFromSource(
  item: { segmentName?: string },
  session: LedSessionTitleConfig
): string {
  if (session.titleSource === 'custom') {
    return session.customTitle.trim();
  }
  return (item.segmentName || '').trim();
}

export function resolveLedTitle(item: { segmentName?: string }, layout: LedLayoutConfig): string {
  if (!layout.sessionTitle.enabled) return '';
  if (layout.sessionTitle.displayText.trim()) {
    return layout.sessionTitle.displayText;
  }
  return getTitleFromSource(item, layout.sessionTitle);
}

export function getSpeakerForLayoutSlot(
  speakersText: string | undefined,
  slot: number
): ParsedSpeaker | null {
  return getSpeakerForSlot(speakersText, slot);
}

export function formatSpeakerSubtitle(speaker: ParsedSpeaker): string {
  const title = speaker.title?.trim() || '';
  const org = speaker.org?.trim() || '';
  if (title && org) return `${title} · ${org}`;
  return title || org;
}

export function ledLayoutToCustomFields(
  existing: Record<string, unknown> | undefined,
  layout: LedLayoutConfig
): Record<string, unknown> {
  return { ...(existing || {}), [LED_LAYOUT_KEY]: layout };
}

export type LedScheduleItem = {
  id: number;
  segmentName?: string;
  speakersText?: string;
  customFields?: Record<string, unknown>;
};

/** Normalize schedule_items from API, websocket, or localStorage (array or JSON string). */
export function parseScheduleItems(raw: unknown): LedScheduleItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as LedScheduleItem[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as LedScheduleItem[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function findScheduleItemById(
  items: LedScheduleItem[],
  id: number | null | undefined
): LedScheduleItem | null {
  if (id == null) return null;
  const want = Number(id);
  return items.find((item) => Number(item.id) === want) ?? null;
}

/** Prefer API schedule text; keep local ledLayout when API row is missing it (stale cache). */
export function mergeLedScheduleItems(
  apiItems: LedScheduleItem[],
  localItems: LedScheduleItem[]
): LedScheduleItem[] {
  if (!apiItems.length) return localItems;
  if (!localItems.length) return apiItems;

  const localById = new Map(localItems.map((item) => [String(item.id), item]));
  return apiItems.map((apiItem) => {
    const local = localById.get(String(apiItem.id));
    const localLayout = local?.customFields?.[LED_LAYOUT_KEY];
    const apiLayout = apiItem.customFields?.[LED_LAYOUT_KEY];
    if (!localLayout || apiLayout) return apiItem;
    return {
      ...apiItem,
      customFields: ledLayoutToCustomFields(
        apiItem.customFields,
        parseLedLayout(localLayout)
      ),
    };
  });
}

export function layoutHasVisibleContent(layout: LedLayoutConfig): boolean {
  if (layout.sessionTitle.enabled) return true;
  return layout.speakers.some((s) => s.enabled);
}

export function getCueOutputAnimation(layout: LedLayoutConfig): LedOutputAnimation {
  return layout.outputAnimation ?? DEFAULT_LED_OUTPUT_ANIMATION;
}

/** @deprecated Use getCueOutputAnimation */
export function resolveCueOutputAnimation(
  layout: LedLayoutConfig,
  _eventDefault?: LedOutputAnimation
): LedOutputAnimation {
  return getCueOutputAnimation(layout);
}

export function snapPercent(value: number, gridSizePx: number, canvasSize: number): number {
  const px = (value / 100) * canvasSize;
  const snapped = Math.round(px / gridSizePx) * gridSizePx;
  return clampPercent((snapped / canvasSize) * 100);
}

export function snapPoint(
  x: number,
  y: number,
  gridSize: number,
  snap: boolean
): { x: number; y: number } {
  if (!snap) return { x: clampPercent(x), y: clampPercent(y) };
  return {
    x: snapPercent(x, gridSize, UHD_WIDTH),
    y: snapPercent(y, gridSize, UHD_HEIGHT),
  };
}

export function elementPositionStyle(
  transform: LedElementTransform,
  interactive: boolean
): CSSProperties {
  const translateX =
    transform.align === 'center' ? '-50%' : transform.align === 'right' ? '-100%' : '0';
  return {
    position: 'absolute',
    left: `${transform.x}%`,
    top: `${transform.y}%`,
    transform: `translateX(${translateX})`,
    maxWidth: `${transform.maxWidth}%`,
    width: 'max-content',
    cursor: interactive ? 'grab' : 'default',
    touchAction: 'none',
  };
}

export function getLayoutSummary(layout: LedLayoutConfig): string {
  const parts: string[] = [];
  if (layout.sessionTitle.enabled) parts.push('Title');
  const speakerCount = layout.speakers.filter((s) => s.enabled).length;
  if (speakerCount) parts.push(`${speakerCount} speaker${speakerCount > 1 ? 's' : ''}`);
  return parts.length ? parts.join(' + ') : 'Empty';
}

export function toggleSpeakerSlot(layout: LedLayoutConfig, slot: number, on: boolean): LedLayoutConfig {
  const existing = layout.speakers.find((s) => s.slot === slot);
  if (on) {
    if (existing) {
      return {
        ...layout,
        speakers: layout.speakers.map((s) => (s.slot === slot ? { ...s, enabled: true } : s)),
      };
    }
    const y = 72 + layout.speakers.filter((s) => s.enabled).length * 8;
    return {
      ...layout,
      speakers: [...layout.speakers, createSpeakerPlacement(slot, 4 + (slot - 1) * 6, Math.min(y, 85))],
    };
  }
  return {
    ...layout,
    speakers: layout.speakers.map((s) => (s.slot === slot ? { ...s, enabled: false } : s)),
  };
}

export function updateSpeakerPlacement(
  layout: LedLayoutConfig,
  id: string,
  patch: Partial<LedSpeakerPlacement>
): LedLayoutConfig {
  return {
    ...layout,
    speakers: layout.speakers.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  };
}

export function listAllSpeakers(speakersText?: string): ParsedSpeaker[] {
  return parseSpeakers(speakersText).filter(
    (s) => s.fullName?.trim() || s.title?.trim() || s.org?.trim()
  );
}
