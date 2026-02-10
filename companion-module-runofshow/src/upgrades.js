module.exports = [
	// Migrate "Stop sync after" checkbox + minutes/hours -> autoDisableSyncAfterHours (0 = off)
	// Then migrate any existing autoDisableSyncAfterMinutes -> autoDisableSyncAfterHours.
	function (context, config, actions, feedbacks) {
		const actionsList = Array.isArray(actions) ? actions : []
		const feedbacksList = Array.isArray(feedbacks) ? feedbacks : []
		if (!config) return { updatedConfig: config, updatedActions: actionsList, updatedFeedbacks: feedbacksList }
		// Already on hours
		if (config.autoDisableSyncAfterHours !== undefined) {
			return { updatedConfig: config, updatedActions: actionsList, updatedFeedbacks: feedbacksList }
		}
		// Convert old minutes field to hours
		if (config.autoDisableSyncAfterMinutes !== undefined) {
			const m = parseInt(config.autoDisableSyncAfterMinutes, 10)
			config.autoDisableSyncAfterHours = Number.isFinite(m) && m > 0
				? Math.min(168, Math.max(1, Math.round(m / 60)))
				: 0
			delete config.autoDisableSyncAfterMinutes
			return { updatedConfig: config, updatedActions: actionsList, updatedFeedbacks: feedbacksList }
		}
		// Legacy: "Stop sync after" checkbox + minutes/hours
		const enabled = config.stopRefreshAfterEnabled === true || config.stopRefreshAfterEnabled === 'true'
		if (!enabled) {
			config.autoDisableSyncAfterHours = 0
		} else {
			const minVal = parseInt(config.stopRefreshAfterMinutes, 10)
			const minutes = Number.isFinite(minVal)
				? Math.max(15, Math.min(4320, Math.round(minVal / 15) * 15))
				: (parseInt(config.stopRefreshAfterHours, 10) || 4) * 60
			config.autoDisableSyncAfterHours = Math.min(168, Math.max(1, Math.round(minutes / 60)))
		}
		return { updatedConfig: config, updatedActions: actionsList, updatedFeedbacks: feedbacksList }
	},
]
