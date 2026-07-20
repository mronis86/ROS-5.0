module.exports = function (self) {
	self.setVariableDefinitions([
		{ variableId: 'mitti_armed', name: 'Mitti sync armed (Yes/No)' },
		{ variableId: 'mitti_sync_status', name: 'Mitti sync status (Off / waiting / locked)' },
		{ variableId: 'mitti_cue_number', name: 'Mitti cue number (armed)' },
		{ variableId: 'mitti_inferred_duration', name: 'Last inferred cue duration (seconds)' },
		{ variableId: 'last_sync_at', name: 'Last Mitti sync (local time)' },
		{ variableId: 'last_sync_reason', name: 'Last sync reason (initial / follow-up / periodic)' },
		{ variableId: 'sync_count', name: 'Total sync count this session' },
		{ variableId: 'last_sync_remaining', name: 'Last synced remaining (seconds)' },
		{ variableId: 'estimated_drift', name: 'ROS vs Mitti drift (+ = ROS ahead)' },
		{ variableId: 'current_cue', name: 'Current Cue' },
		{ variableId: 'timer_running', name: 'Timer Running (Yes/No)' },
		{ variableId: 'event_name', name: 'Event Name' },
	])
}
