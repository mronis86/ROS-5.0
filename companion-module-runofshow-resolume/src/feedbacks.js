const { combineRgb } = require('@companion-module/base')

module.exports = async function (self) {
	self.setFeedbackDefinitions({
		resolume_armed: {
			name: 'Resolume sync armed',
			type: 'boolean',
			label: 'Resolume sync armed',
			defaultStyle: {
				bgcolor: combineRgb(120, 60, 160),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.resolumeArm != null && self.resolumeArm.phase !== 'aligned',
		},
		resolume_aligned: {
			name: 'Resolume sync aligned (timer locked)',
			type: 'boolean',
			label: 'Resolume sync aligned',
			defaultStyle: {
				bgcolor: combineRgb(0, 140, 60),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.resolumeArm?.phase === 'aligned',
		},
		resolume_sync_pulse: {
			name: 'Resolume just synced (2s flash)',
			type: 'boolean',
			label: 'Resolume sync pulse',
			defaultStyle: {
				bgcolor: combineRgb(0, 180, 220),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: () => self.syncPulseActive === true,
		},
		sub_timer_running: {
			name: 'Sub-cue timer running',
			type: 'boolean',
			label: 'Sub-cue timer running',
			defaultStyle: {
				bgcolor: combineRgb(120, 70, 160),
				color: combineRgb(255, 255, 255),
			},
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Sub-cue (blank = any)',
					default: '',
					choices: [{ id: '', label: 'Any sub-cue running' }, ...self.buildCueDropdownChoices(self.getSubCues())],
				},
			],
			callback: (feedback) => {
				if (!self.subCueTimer?.is_running) return false
				const want = feedback.options.itemId
				if (!want) return true
				return String(self.subCueTimer.item_id) === String(want)
			},
		},
	})
}
