/** Shared DSM Clock layout mode helpers (API + Companion). */

const DSM_LAYOUT_MODES = ['full', 'led', 'vid', 'ppt'];

/**
 * Normalize any raw mode string to full | led | vid | ppt.
 * Legacy "16x9" maps to led.
 */
function normalizeDsmLayoutMode(raw) {
  const m = String(raw || '')
    .toLowerCase()
    .replace(/[\s:_-]+/g, '');
  if (m === 'full' || m === 'fulldsm') return 'full';
  if (m === 'vid' || m === 'video' || m === 'viddsm' || m === 'videodsm') return 'vid';
  if (m === 'ppt' || m === 'powerpoint' || m === 'pptdsm') return 'ppt';
  if (
    m === 'led' ||
    m === 'leddsm' ||
    m === '16x9' ||
    m === '169' ||
    m === ''
  ) {
    return 'led';
  }
  if (DSM_LAYOUT_MODES.includes(m)) return m;
  return 'led';
}

/** Default mode from row context: PPT > Video > LED. */
function suggestedDsmLayoutMode(item) {
  if (!item || typeof item !== 'object') return 'led';
  if (item.hasPPT === true || item.hasPPT === 'true' || item.hasPPT === 1) return 'ppt';
  const pt = String(item.programType || '').toLowerCase();
  if (pt.includes('video') || pt === 'vid' || pt.includes('playback')) return 'vid';
  return 'led';
}

/** Whether DSM Clock should use the 16:9 reference frame (everything except Full). */
function dsmLayoutUsesSixteenByNine(mode) {
  return normalizeDsmLayoutMode(mode) !== 'full';
}

function dsmLayoutDisplayLabel(mode) {
  switch (normalizeDsmLayoutMode(mode)) {
    case 'full':
      return 'Full DSM';
    case 'vid':
      return 'VID DSM';
    case 'ppt':
      return 'PPT DSM';
    default:
      return 'LED DSM';
  }
}

const DSM_FULL_ZOOM_MIN = 80;
const DSM_FULL_ZOOM_MAX = 100;
const DSM_FULL_ZOOM_STEP = 5;
const DSM_FULL_ZOOM_DEFAULT = 100;
const DSM_FULL_ZOOM_LEVELS = [80, 85, 90, 95, 100];

/** Full DSM clock zoom percent (event setting). Steps of 5 from 80–100; default 100. */
function normalizeDsmFullZoom(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DSM_FULL_ZOOM_DEFAULT;
  const clamped = Math.min(DSM_FULL_ZOOM_MAX, Math.max(DSM_FULL_ZOOM_MIN, n));
  return Math.round(clamped / DSM_FULL_ZOOM_STEP) * DSM_FULL_ZOOM_STEP;
}

module.exports = {
  DSM_LAYOUT_MODES,
  normalizeDsmLayoutMode,
  suggestedDsmLayoutMode,
  dsmLayoutUsesSixteenByNine,
  dsmLayoutDisplayLabel,
  DSM_FULL_ZOOM_MIN,
  DSM_FULL_ZOOM_MAX,
  DSM_FULL_ZOOM_STEP,
  DSM_FULL_ZOOM_DEFAULT,
  DSM_FULL_ZOOM_LEVELS,
  normalizeDsmFullZoom,
};
