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
	})
}
