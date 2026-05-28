module.exports = function (self) {
	self.setVariableDefinitions([
		{ variableId: 'resolume_armed', name: 'Resolume sync armed (Yes/No)' },
		{ variableId: 'resolume_sync_status', name: 'Resolume sync status (Off / waiting / locked)' },
		{ variableId: 'resolume_layer', name: 'Resolume layer (armed)' },
		{ variableId: 'resolume_clip', name: 'Resolume clip (armed)' },
		{ variableId: 'resolume_inferred_duration', name: 'Last inferred clip duration (seconds)' },
		{ variableId: 'last_sync_at', name: 'Last Resolume sync (local time)' },
		{ variableId: 'last_sync_reason', name: 'Last sync reason (initial / follow-up / periodic)' },
		{ variableId: 'sync_count', name: 'Total sync count this session' },
		{ variableId: 'last_sync_remaining', name: 'Last synced remaining (seconds)' },
		{ variableId: 'estimated_drift', name: 'ROS vs Resolume drift (+ = ROS ahead)' },
		{ variableId: 'current_cue', name: 'Current Cue' },
		{ variableId: 'sub_cue', name: 'Running Sub-Cue' },
		{ variableId: 'sub_timer_running', name: 'Sub-Cue Timer Running (Yes/No)' },
		{ variableId: 'timer_running', name: 'Timer Running (Yes/No)' },
		{ variableId: 'event_name', name: 'Event Name' },
	])
}
