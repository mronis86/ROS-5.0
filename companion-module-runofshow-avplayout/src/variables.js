module.exports = function (self) {
	self.setVariableDefinitions([
		{ variableId: 'avplayout_armed', name: 'AV-Playout sync armed (Yes/No)' },
		{ variableId: 'avplayout_sync_status', name: 'AV-Playout sync status' },
		{ variableId: 'avplayout_cue_index', name: 'AV-Playout cue index (armed)' },
		{ variableId: 'avplayout_connected', name: 'AV-Playout WS connected (Yes/No)' },
		{ variableId: 'avplayout_phase', name: 'AV-Playout playback phase' },
		{ variableId: 'avplayout_remaining', name: 'AV-Playout remaining (seconds)' },
		{ variableId: 'avplayout_duration', name: 'AV-Playout duration (seconds)' },
		{ variableId: 'last_sync_at', name: 'Last sync (local time)' },
		{ variableId: 'last_sync_reason', name: 'Last sync reason' },
		{ variableId: 'sync_count', name: 'Total sync count this session' },
		{ variableId: 'last_sync_remaining', name: 'Last synced remaining (seconds)' },
		{ variableId: 'estimated_drift', name: 'ROS vs AV-Playout drift (+ = ROS ahead)' },
		{ variableId: 'current_cue', name: 'Current Cue' },
		{ variableId: 'timer_running', name: 'Timer Running (Yes/No)' },
		{ variableId: 'event_name', name: 'Event Name' },
	])
}
