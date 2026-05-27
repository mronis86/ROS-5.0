module.exports = function (self) {
	self.setVariableDefinitions([
		{ variableId: 'resolume_armed', name: 'Resolume sync armed (Yes/No)' },
		{ variableId: 'resolume_layer', name: 'Resolume layer (armed)' },
		{ variableId: 'resolume_clip', name: 'Resolume clip (armed)' },
		{ variableId: 'resolume_inferred_duration', name: 'Last inferred clip duration (seconds)' },
		{ variableId: 'current_cue', name: 'Current Cue' },
		{ variableId: 'timer_running', name: 'Timer Running (Yes/No)' },
		{ variableId: 'event_name', name: 'Event Name' },
	])
}
