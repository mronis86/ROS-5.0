module.exports = function (self) {
	const regularCueChoices = self.buildCueDropdownChoices(
		self.getRegularCues(),
		'No main cues — configure Event ID first'
	)
	const subCueChoices = self.buildCueDropdownChoices(
		self.getSubCues(),
		'No sub-cues — add indented rows in Run of Show'
	)

	self.setActionDefinitions({
		arm_resolume_sync: {
			name: 'Arm Resolume sync (load cue + listen)',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Main cue / Row',
					default: '',
					choices: regularCueChoices,
				},
				{
					id: 'layer',
					type: 'number',
					label: 'Resolume layer',
					default: 1,
					min: 1,
					max: 64,
				},
				{
					id: 'clip',
					type: 'number',
					label: 'Resolume clip',
					default: 1,
					min: 1,
					max: 64,
				},
				{
					id: 'triggerOnArm',
					type: 'checkbox',
					label: 'Trigger Resolume on arm',
					default: true,
				},
				{
					id: 'triggerType',
					type: 'dropdown',
					label: 'Trigger target',
					default: 'clip',
					choices: [
						{ id: 'clip', label: 'Clip connect (watch layer/clip)' },
						{ id: 'column', label: 'Column connect (still watch layer/clip)' },
					],
				},
				{
					id: 'column',
					type: 'number',
					label: 'Resolume column (used when target=column)',
					default: 1,
					min: 1,
					max: 64,
				},
			],
			callback: async (event) => {
				await self.runArmResolumeSync(event.options, { requireSubCue: false })
			},
		},
		arm_resolume_sub_sync: {
			name: 'Arm Resolume sync (sub-cue — loads parent + listen)',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Sub-cue / Row',
					default: '',
					choices: subCueChoices,
				},
				{
					id: 'layer',
					type: 'number',
					label: 'Resolume layer',
					default: 1,
					min: 1,
					max: 64,
				},
				{
					id: 'clip',
					type: 'number',
					label: 'Resolume clip',
					default: 1,
					min: 1,
					max: 64,
				},
				{
					id: 'triggerOnArm',
					type: 'checkbox',
					label: 'Trigger Resolume on arm',
					default: true,
				},
				{
					id: 'triggerType',
					type: 'dropdown',
					label: 'Trigger target',
					default: 'clip',
					choices: [
						{ id: 'clip', label: 'Clip connect (watch layer/clip)' },
						{ id: 'column', label: 'Column connect (still watch layer/clip)' },
					],
				},
				{
					id: 'column',
					type: 'number',
					label: 'Resolume column (used when target=column)',
					default: 1,
					min: 1,
					max: 64,
				},
			],
			callback: async (event) => {
				await self.runArmResolumeSync(event.options, { requireSubCue: true })
			},
		},
		disarm_resolume_sync: {
			name: 'Disarm Resolume sync',
			options: [],
			callback: async () => {
				await self.clearResolumeArm()
				self.log('info', 'Resolume sync disarmed')
			},
		},
		end_resolume_sync: {
			name: 'End Resolume sync (clear time source)',
			options: [],
			callback: async () => {
				const eventId = self.config?.eventId
				if (!eventId) return
				try {
					await self.apiPost('/api/timers/resolume-end', { event_id: eventId })
					await self.clearResolumeArm()
					self.log('info', 'Resolume time source cleared')
				} catch (err) {
					self.log('error', `End Resolume sync failed: ${err.message}`)
				}
			},
		},
		manual_resolume_align: {
			name: 'Manual Resolume align (test without OSC)',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Main cue / Row',
					default: '',
					choices: regularCueChoices,
				},
				{
					id: 'durationSeconds',
					type: 'number',
					label: 'Clip duration (seconds)',
					default: 300,
					min: 1,
					max: 86400,
				},
				{
					id: 'remainingSeconds',
					type: 'number',
					label: 'Remaining (seconds)',
					default: 300,
					min: 0,
					max: 86400,
				},
			],
			callback: async (event) => {
				const eventId = self.config?.eventId
				const itemId = event.options.itemId
				if (!eventId || !itemId) {
					self.log('warn', 'Manual align: Event ID and Cue are required')
					return
				}
				try {
					const item = self.scheduleItems.find((s) => String(s.id) === String(itemId))
					const cueIs = item?.customFields?.cue ?? `CUE ${itemId}`
					const dur = parseInt(event.options.durationSeconds, 10) || 300
					const rem = parseInt(event.options.remainingSeconds, 10)
					await self.postResolumeAlign({
						eventId,
						itemId,
						cueIs,
						durationSeconds: dur,
						remainingSeconds: rem,
					})
					self.recordSyncSuccess('manual', rem, dur)
					self.log('info', `Manual align: ${rem}s remaining of ${dur}s (button should turn green)`)
				} catch (err) {
					self.log('error', `Manual align failed: ${err.message}`)
				}
			},
		},
		load_cue: {
			name: 'Load Cue',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Main cue / Row',
					default: '',
					choices: regularCueChoices,
				},
			],
			callback: async (event) => {
				const eventId = self.config?.eventId
				const itemId = event.options.itemId
				if (!eventId || !itemId) return
				const item = self.scheduleItems.find((s) => String(s.id) === String(itemId))
				if (item?.isIndented) {
					self.log('warn', 'Load Cue: use a main cue row, not a sub-cue')
					return
				}
				try {
					await self.loadCueForResolume(eventId, itemId)
					self.log('info', `Loaded cue ${itemId}`)
				} catch (err) {
					self.log('error', `Load Cue failed: ${err.message}`)
				}
			},
		},
		resolume_set_cue_duration: {
			name: 'Set main cue duration from Resolume clip',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Main cue / Row to update',
					default: '',
					choices: regularCueChoices,
				},
				{
					id: 'layer',
					type: 'number',
					label: 'Resolume layer',
					default: 1,
					min: 1,
					max: 64,
				},
				{
					id: 'clip',
					type: 'number',
					label: 'Resolume clip',
					default: 1,
					min: 1,
					max: 64,
				},
				{
					id: 'durationSeconds',
					type: 'number',
					label: 'Duration (seconds, 0 = sample from OSC)',
					default: 0,
					min: 0,
					max: 86400,
					tooltip: 'Leave 0 to measure from clip playback via OSC while sampling',
				},
				{
					id: 'sampleMs',
					type: 'number',
					label: 'OSC sample time (ms)',
					default: 600,
					min: 200,
					max: 5000,
				},
				{
					id: 'triggerClip',
					type: 'checkbox',
					label: 'Trigger clip before sampling',
					default: true,
				},
			],
			callback: async (event) => {
				await self.runSetCueDurationFromClip(event.options, { requireSubCue: false })
			},
		},
		resolume_set_subcue_duration: {
			name: 'Set sub-cue duration from Resolume clip',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Sub-cue / Row to update',
					default: '',
					choices: subCueChoices,
				},
				{
					id: 'layer',
					type: 'number',
					label: 'Resolume layer',
					default: 1,
					min: 1,
					max: 64,
				},
				{
					id: 'clip',
					type: 'number',
					label: 'Resolume clip',
					default: 1,
					min: 1,
					max: 64,
				},
				{
					id: 'durationSeconds',
					type: 'number',
					label: 'Duration (seconds, 0 = sample from OSC)',
					default: 0,
					min: 0,
					max: 86400,
					tooltip: 'Leave 0 to measure from clip playback via OSC while sampling',
				},
				{
					id: 'sampleMs',
					type: 'number',
					label: 'OSC sample time (ms)',
					default: 600,
					min: 200,
					max: 5000,
				},
				{
					id: 'triggerClip',
					type: 'checkbox',
					label: 'Trigger clip before sampling',
					default: true,
				},
			],
			callback: async (event) => {
				await self.runSetCueDurationFromClip(event.options, { requireSubCue: true })
			},
		},
		stop_timer: {
			name: 'Stop Timer',
			options: [],
			callback: async () => {
				const eventId = self.config?.eventId
				if (!eventId) return
				try {
					await self.fetchActiveTimer(eventId)
					const itemId = self.activeTimer?.item_id
					if (!itemId) return
					await self.apiPost('/api/timers/stop', {
						event_id: eventId,
						item_id: parseInt(itemId, 10),
					})
					await self.clearResolumeArm()
					await self.fetchActiveTimer(eventId)
					self.updateVariableValues()
					self.log('info', 'Timer stopped')
				} catch (err) {
					self.log('error', `Stop Timer failed: ${err.message}`)
				}
			},
		},
	})
}
