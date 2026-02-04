const { combineRgb } = require('@companion-module/base')

module.exports = async function (self) {
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
	})
}
