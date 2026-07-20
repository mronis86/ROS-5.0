const { combineRgb } = require('@companion-module/base')

module.exports = async function (self) {
	self.setFeedbackDefinitions({
		mitti_armed: {
			name: 'Mitti sync armed',
			type: 'boolean',
			label: 'Mitti sync armed',
			defaultStyle: {
				bgcolor: combineRgb(120, 60, 160),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.mittiArm != null && self.mittiArm.phase !== 'aligned',
		},
		mitti_aligned: {
			name: 'Mitti sync aligned (timer locked)',
			type: 'boolean',
			label: 'Mitti sync aligned',
			defaultStyle: {
				bgcolor: combineRgb(0, 140, 60),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.mittiArm?.phase === 'aligned',
		},
		mitti_sync_pulse: {
			name: 'Mitti just synced (2s flash)',
			type: 'boolean',
			label: 'Mitti sync pulse',
			defaultStyle: {
				bgcolor: combineRgb(0, 180, 220),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: () => self.syncPulseActive === true,
		},
	})
}
