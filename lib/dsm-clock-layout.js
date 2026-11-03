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

module.exports = {
  DSM_LAYOUT_MODES,
  normalizeDsmLayoutMode,
  suggestedDsmLayoutMode,
  dsmLayoutUsesSixteenByNine,
  dsmLayoutDisplayLabel,
};
