/** DSM Clock layout modes for the schedule DSM column + /dsm-clock page. */

export const DSM_LAYOUT_MODES = ['full', 'led', 'vid', 'ppt'] as const;
export type DsmLayoutMode = (typeof DSM_LAYOUT_MODES)[number];

export const DSM_LAYOUT_OPTIONS: { value: DsmLayoutMode; label: string }[] = [
  { value: 'full', label: 'Full DSM' },
  { value: 'led', label: 'LED DSM' },
  { value: 'vid', label: 'VID DSM' },
  { value: 'ppt', label: 'PPT DSM' },
];

/** Normalize any raw mode string to full | led | vid | ppt. Legacy "16x9" → led. */
export function normalizeDsmLayoutMode(raw: unknown): DsmLayoutMode {
  const m = String(raw || '')
    .toLowerCase()
    .replace(/[\s:_-]+/g, '');
  if (m === 'full' || m === 'fulldsm') return 'full';
  if (m === 'vid' || m === 'video' || m === 'viddsm' || m === 'videodsm') return 'vid';
  if (m === 'ppt' || m === 'powerpoint' || m === 'pptdsm') return 'ppt';
  if (m === 'led' || m === 'leddsm' || m === '16x9' || m === '169' || m === '') return 'led';
  if ((DSM_LAYOUT_MODES as readonly string[]).includes(m)) return m as DsmLayoutMode;
  return 'led';
}

/** Default mode from row context: PPT checked → PPT; Video program type → VID; else LED. */
export function suggestedDsmLayoutMode(item: {
  programType?: string | null;
  hasPPT?: boolean | null;
} | null | undefined): DsmLayoutMode {
  if (!item) return 'led';
  if (item.hasPPT === true) return 'ppt';
  const pt = String(item.programType || '').toLowerCase();
  if (pt.includes('video') || pt === 'vid' || pt.includes('playback')) return 'vid';
  return 'led';
}

/** Effective mode for a row (manual override wins; otherwise PPT / Video / LED). */
export function effectiveDsmLayoutMode(item: {
  programType?: string | null;
  hasPPT?: boolean | null;
  dsmMode?: string | null;
  dsmModeManual?: boolean | null;
} | null | undefined): DsmLayoutMode {
  if (item?.dsmModeManual && item.dsmMode) return normalizeDsmLayoutMode(item.dsmMode);
  return suggestedDsmLayoutMode(item);
}

/** Whether DSM Clock should use the 16:9 reference frame (everything except Full). */
export function dsmLayoutUsesSixteenByNine(mode: unknown): boolean {
  return normalizeDsmLayoutMode(mode) !== 'full';
}

/** Map socket/API mode → force16x9 boolean; null if unrecognized empty. */
export function applyDsmLayoutModeToForce16x9(mode: unknown): boolean | null {
  if (mode == null || mode === '') return null;
  return dsmLayoutUsesSixteenByNine(mode);
}
