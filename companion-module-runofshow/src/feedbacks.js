const { combineRgb } = require('@companion-module/base')

module.exports = async function (self) {
	// Same cue list as Load Cue (labels show CUE 1 / CUE 1.1 not just 1)
	const cueChoices = (self.scheduleItems || []).map((item) => {
		const cueDisplay = self.formatCueDisplay ? self.formatCueDisplay(item.customFields?.cue, item.id) : (item.customFields?.cue ?? `CUE ${item.id}`)
		const label = `${cueDisplay}: ${item.segmentName || 'Untitled'}`
		return { id: String(item.id), label }
	})

	self.setFeedbackDefinitions({
		timer_running: {
			name: 'Timer Running',
			type: 'boolean',
			label: 'Timer Running',
			defaultStyle: {
				bgcolor: combineRgb(0, 200, 0),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: () => self.activeTimer?.is_running === true,
		},
		cue_loaded: {
			name: 'Cue Loaded',
			type: 'boolean',
			label: 'Cue Loaded',
			defaultStyle: {
				bgcolor: combineRgb(50, 100, 200),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.activeTimer != null && self.activeTimer.item_id != null,
		},
		loaded_cue_is: {
			name: 'Loaded cue is',
			type: 'boolean',
			label: 'Loaded cue is (choice)',
			defaultStyle: {
				bgcolor: combineRgb(50, 100, 200),
				color: combineRgb(255, 255, 255),
			},
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Cue',
					default: cueChoices.length > 0 ? cueChoices[0].id : '',
					choices: cueChoices.length > 0 ? cueChoices : [{ id: '', label: 'No cues - set Event ID first' }],
					tooltip: 'Feedback is true when this cue is the one currently loaded (same list as Load Cue)',
				},
			],
			callback: (feedback) => {
				const selectedId = feedback.options?.itemId
				if (selectedId == null || selectedId === '') return false
				return String(self.activeTimer?.item_id) === String(selectedId)
			},
		},
		// Set button text from dropdown: pick a cue and show Cue (e.g. CUE 1) or Segment (e.g. Opening)
		button_text_from_cue: {
			name: 'Button text from cue (dropdown)',
			type: 'advanced',
			label: 'Button text from cue',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Cue',
					default: cueChoices.length > 0 ? cueChoices[0].id : '',
					choices: cueChoices.length > 0 ? cueChoices : [{ id: '', label: 'No cues - set Event ID first' }],
					tooltip: 'Same list as Load Cue. Button text will show the cue or segment for this row.',
				},
				{
					id: 'showAs',
					type: 'dropdown',
					label: 'Show as',
					default: 'cue',
					choices: [
						{ id: 'cue', label: 'Cue (e.g. CUE 1 or CUE 1.1)' },
						{ id: 'segment', label: 'Segment (e.g. Opening)' },
					],
					tooltip: 'Cue = cue label; Segment = segment name for that row.',
				},
			],
			callback: (feedback) => {
				const selectedId = feedback.options?.itemId
				const showAs = feedback.options?.showAs || 'cue'
				if (selectedId == null || selectedId === '') return {}
				const item = self.scheduleItems.find((s) => String(s.id) === String(selectedId))
				if (!item) return {}
				const cueDisplay = self.formatCueDisplay ? self.formatCueDisplay(item.customFields?.cue, item.id) : (item.customFields?.cue ?? `CUE ${item.id}`)
				const segment = item.segmentName || 'Untitled'
				const text = showAs === 'segment' ? segment : cueDisplay
				return { text }
			},
		},
		// Display timer elapsed / remaining / duration as button text (with label prefix)
		button_text_timer_elapsed: {
			name: 'Button text: Timer elapsed',
			type: 'advanced',
			label: 'Button text: Timer elapsed',
			options: [],
			callback: () => {
				const v = self.getTimerDisplayValues ? self.getTimerDisplayValues() : { elapsed: '—' }
				return { text: `Elapsed: ${v.elapsed}` }
			},
		},
		button_text_timer_remaining: {
			name: 'Button text: Timer remaining',
			type: 'advanced',
			label: 'Button text: Timer remaining',
			options: [],
			callback: () => {
				const v = self.getTimerDisplayValues ? self.getTimerDisplayValues() : { remaining: '—' }
				return { text: `Remaining: ${v.remaining}` }
			},
		},
		button_text_timer_duration: {
			name: 'Button text: Timer duration',
			type: 'advanced',
			label: 'Button text: Timer duration',
			options: [],
			callback: () => {
				const v = self.getTimerDisplayValues ? self.getTimerDisplayValues() : { duration: '—' }
				return { text: `Duration: ${v.duration}` }
			},
		},
		// Adaptive timer: Duration when loaded, Remaining when running, Overtime when over. Two-line: label (small) \n value (large)
		button_text_timer_adaptive: {
			name: 'Button text: Timer (adaptive)',
			type: 'advanced',
			label: 'Timer adaptive (Duration / Remaining / Overtime)',
			options: [
				{
					id: 'labelStyle',
					type: 'dropdown',
					label: 'Label style',
					default: 'short',
					choices: [
						{ id: 'short', label: 'Short (Dur, Rem, OT) – less visual weight at top' },
						{ id: 'full', label: 'Full (Duration, Remaining, Overtime)' },
					],
					tooltip: 'Short labels take less space so the timer value stands out',
				},
				{
					id: 'overtimeColor',
					type: 'dropdown',
					label: 'Overtime color',
					default: 'red',
					choices: [
						{ id: 'red', label: 'Red' },
						{ id: 'amber', label: 'Amber' },
						{ id: 'same', label: 'Same as normal' },
					],
					tooltip: 'Button background color when timer is in overtime',
				},
			],
			callback: (feedback) => {
				const v = self.getTimerDisplayValues ? self.getTimerDisplayValues() : {}
				const overtimeColor = feedback.options?.overtimeColor || 'red'
				const labelStyle = feedback.options?.labelStyle || 'short'
				let label = '—'
				let value = '—'
				if (self.activeTimer && self.activeTimer.item_id != null) {
					if (v.isOvertime) {
						label = labelStyle === 'short' ? 'OT' : 'Overtime'
						value = v.overtimeFormatted || '—'
					} else if (self.activeTimer.is_running === true) {
						label = labelStyle === 'short' ? 'Rem' : 'Remaining'
						value = v.remaining || '—'
					} else {
						label = labelStyle === 'short' ? 'Dur' : 'Duration'
						value = v.duration || '—'
					}
				}
				const text = `${label}\n${value}`
				const result = { text }
				if (v.isOvertime && overtimeColor !== 'same') {
					if (overtimeColor === 'red') {
						result.bgcolor = combineRgb(160, 0, 0)
						result.color = combineRgb(255, 255, 255)
					} else if (overtimeColor === 'amber') {
						result.bgcolor = combineRgb(200, 120, 0)
						result.color = combineRgb(0, 0, 0)
					}
				}
				return result
			},
		},
	})
}
