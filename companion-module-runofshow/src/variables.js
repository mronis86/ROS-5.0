module.exports = function (self) {
	const base = [
		{ variableId: 'current_cue', name: 'Current Cue' },
		{ variableId: 'current_segment', name: 'Current Segment Name' },
		{ variableId: 'loaded_cue_value', name: 'Loaded Cue Value' },
		{ variableId: 'timer_running', name: 'Timer Running (Yes/No)' },
		{ variableId: 'event_name', name: 'Event Name' },
	]
	// Per-cue variables: use $(runofshow:cue_<itemId>_label) and $(runofshow:cue_<itemId>_value) in button text
	// so each button can show the cue name/value for the cue selected in that button's Load Cue dropdown
	const items = self.scheduleItems || []
	const perCue = items.flatMap((item) => {
		const cueDisplay = self.formatCueDisplay ? self.formatCueDisplay(item.customFields?.cue, item.id) : (item.customFields?.cue ?? `CUE ${item.id}`)
		const label = `${cueDisplay}: ${item.segmentName || 'Untitled'}`
		return [
			{ variableId: `cue_${item.id}_label`, name: `${label} (label)` },
			{ variableId: `cue_${item.id}_value`, name: `${label} (value)` },
		]
	})
	self.setVariableDefinitions([...base, ...perCue])
}
