'use strict'

/** Row / cue modes (ROS schedule DSM column). */
const DSM_LAYOUT_MODES = ['full', 'led', 'vid', 'ppt']

/** Companion still buttons — cue-load + manual press. Not layout frames. */
const DSM_STILL_MODES = ['led', 'vid', 'ppt']

/** Manual Companion layout overrides (DSM Clock frame only). */
const DSM_FRAME_MODES = ['full', '16x9']

function normalizeDsmLayoutMode(raw) {
	const m = String(raw || '')
		.toLowerCase()
		.replace(/[\s:_-]+/g, '')
	if (m === 'full' || m === 'fulldsm') return 'full'
	if (m === 'vid' || m === 'video' || m === 'viddsm' || m === 'videodsm') return 'vid'
	if (m === 'ppt' || m === 'powerpoint' || m === 'pptdsm') return 'ppt'
	if (m === 'led' || m === 'leddsm' || m === '16x9' || m === '169' || m === '') return 'led'
	if (DSM_LAYOUT_MODES.includes(m)) return m
	return 'led'
}

/** LED / VID / PPT only — never maps 16x9 or full into a still. */
function normalizeDsmStillMode(raw) {
	const m = String(raw || '')
		.toLowerCase()
		.replace(/[\s:_-]+/g, '')
	if (m === 'vid' || m === 'video' || m === 'viddsm' || m === 'videodsm') return 'vid'
	if (m === 'ppt' || m === 'powerpoint' || m === 'pptdsm') return 'ppt'
	if (m === 'led' || m === 'leddsm') return 'led'
	return null
}

/** DSM Clock frame: Full (16:9 off) or 16x9 on. */
function normalizeDsmFrameMode(raw) {
	const m = String(raw || '')
		.toLowerCase()
		.replace(/[\s:_-]+/g, '')
	if (m === 'full' || m === 'fulldsm' || m === '16x9off' || m === 'off') return 'full'
	return '16x9'
}

function isDsmStillMode(raw) {
	return normalizeDsmStillMode(raw) != null
}

function suggestedDsmLayoutMode(item) {
	if (!item || typeof item !== 'object') return 'led'
	if (item.hasPPT === true || item.hasPPT === 'true' || item.hasPPT === 1) return 'ppt'
	const pt = String(item.programType || '').toLowerCase()
	if (pt.includes('video') || pt === 'vid' || pt.includes('playback')) return 'vid'
	return 'led'
}

function effectiveDsmLayoutMode(item) {
	if (item?.dsmModeManual && item.dsmMode) return normalizeDsmLayoutMode(item.dsmMode)
	return suggestedDsmLayoutMode(item)
}

function dsmLayoutLabel(mode) {
	const still = normalizeDsmStillMode(mode)
	if (still === 'vid') return 'VID DSM'
	if (still === 'ppt') return 'PPT DSM'
	if (still === 'led') return 'LED DSM'
	const raw = String(mode || '')
		.toLowerCase()
		.replace(/[\s:_-]+/g, '')
	if (raw === '16x9' || raw === '169') return 'DSM 16:9'
	if (raw === 'full' || raw === 'fulldsm' || normalizeDsmLayoutMode(mode) === 'full') return 'Full DSM'
	return 'LED DSM'
}

function dsmFrameLabel(frame) {
	return normalizeDsmFrameMode(frame) === 'full' ? 'DSM Full' : 'DSM 16:9'
}

module.exports = {
	DSM_LAYOUT_MODES,
	DSM_STILL_MODES,
	DSM_FRAME_MODES,
	normalizeDsmLayoutMode,
	normalizeDsmStillMode,
	normalizeDsmFrameMode,
	isDsmStillMode,
	suggestedDsmLayoutMode,
	effectiveDsmLayoutMode,
	dsmLayoutLabel,
	dsmFrameLabel,
}
