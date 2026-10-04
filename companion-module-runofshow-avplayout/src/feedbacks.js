const { combineRgb } = require('@companion-module/base')

module.exports = async function (self) {
	self.setFeedbackDefinitions({
		avplayout_armed: {
			name: 'AV-Playout sync armed',
			type: 'boolean',
			label: 'AV-Playout sync armed',
			defaultStyle: {
				bgcolor: combineRgb(120, 60, 160),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.avArm != null && self.avArm.phase !== 'aligned',
		},
		avplayout_aligned: {
			name: 'AV-Playout sync aligned (timer locked)',
			type: 'boolean',
			label: 'AV-Playout sync aligned',
			defaultStyle: {
				bgcolor: combineRgb(0, 140, 60),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.avArm?.phase === 'aligned',
		},
		avplayout_sync_pulse: {
			name: 'AV-Playout just synced (2s flash)',
			type: 'boolean',
			label: 'AV-Playout sync pulse',
			defaultStyle: {
				bgcolor: combineRgb(0, 180, 220),
				color: combineRgb(0, 0, 0),
			},
			options: [],
			callback: () => self.syncPulseActive === true,
		},
		avplayout_connected: {
			name: 'AV-Playout WebSocket connected',
			type: 'boolean',
			label: 'AV-Playout connected',
			defaultStyle: {
				bgcolor: combineRgb(0, 120, 80),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.avConnected === true,
		},
	})
}
