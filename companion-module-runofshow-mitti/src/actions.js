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
		arm_mitti_sync: {
			name: 'Arm Mitti sync (load cue + listen)',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Main cue / Row',
					default: '',
					choices: regularCueChoices,
				},
				{
					id: 'cueNumber',
					type: 'number',
					label: 'Mitti cue number',
					default: 1,
					min: 1,
					max: 999,
				},
				{
					id: 'triggerOnArm',
					type: 'checkbox',
					label: 'Trigger Mitti on arm',
					default: true,
				},
				{
					id: 'triggerMode',
					type: 'dropdown',
					label: 'Trigger mode',
					default: 'cue',
					choices: [
						{ id: 'cue', label: 'Play cue (/mitti/N/play)' },
						{ id: 'select_then_play', label: 'Select cue then play playlist' },
						{ id: 'playlist', label: 'Play playlist only (/mitti/play)' },
					],
				},
			],
			callback: async (event) => {
				await self.runArmMittiSync(event.options, { requireSubCue: false })
			},
		},
		arm_mitti_sub_sync: {
			name: 'Arm Mitti sync (sub-cue — loads parent + listen)',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Sub-cue / Row',
					default: '',
					choices: subCueChoices,
				},
				{
					id: 'cueNumber',
					type: 'number',
					label: 'Mitti cue number',
					default: 1,
					min: 1,
					max: 999,
				},
				{
					id: 'triggerOnArm',
					type: 'checkbox',
					label: 'Trigger Mitti on arm',
					default: true,
				},
				{
					id: 'triggerMode',
					type: 'dropdown',
					label: 'Trigger mode',
					default: 'cue',
					choices: [
						{ id: 'cue', label: 'Play cue (/mitti/N/play)' },
						{ id: 'select_then_play', label: 'Select cue then play playlist' },
						{ id: 'playlist', label: 'Play playlist only (/mitti/play)' },
					],
				},
			],
			callback: async (event) => {
				await self.runArmMittiSync(event.options, { requireSubCue: true })
			},
		},
		disarm_mitti_sync: {
			name: 'Disarm Mitti sync',
			options: [],
			callback: async () => {
				await self.clearMittiArm()
				self.log('info', 'Mitti sync disarmed')
			},
		},
		end_mitti_sync: {
			name: 'End Mitti sync (clear time source)',
			options: [],
			callback: async () => {
				const eventId = self.config?.eventId
				if (!eventId) return
				try {
					await self.apiPost('/api/timers/mitti-end', { event_id: eventId })
					await self.clearMittiArm()
					self.log('info', 'Mitti time source cleared')
				} catch (err) {
					self.log('error', `End Mitti sync failed: ${err.message}`)
				}
			},
		},
		manual_mitti_align: {
			name: 'Manual Mitti align (test without OSC)',
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
					label: 'Cue duration (seconds)',
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
					await self.postMittiAlign({
						eventId,
						itemId,
						cueIs,
						durationSeconds: dur,
						remainingSeconds: rem,
					})
					self.recordSyncSuccess('manual', rem, dur)
					self.log('info', `Manual align: ${rem}s remaining of ${dur}s`)
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
					await self.loadCueForMitti(eventId, itemId)
					self.log('info', `Loaded cue ${itemId}`)
				} catch (err) {
					self.log('error', `Load Cue failed: ${err.message}`)
				}
			},
		},
		mitti_pull_trt: {
			name: 'Pull Mitti TRT into ROS cue duration',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Main cue / Row to update',
					default: '',
					choices: regularCueChoices,
				},
				{
					id: 'cueNumber',
					type: 'number',
					label: 'Mitti cue number to sample',
					default: 1,
					min: 1,
					max: 999,
					tooltip: 'Mitti only reports TRT for the current cue — we select this cue briefly',
				},
				{
					id: 'restoreCueNumber',
					type: 'number',
					label: 'Restore Mitti cue after sample (0 = last known current)',
					default: 0,
					min: 0,
					max: 999,
					tooltip:
						'After reading TRT, re-select this cue so show position is restored. 0 uses last OSC current cue.',
				},
				{
					id: 'sampleMs',
					type: 'number',
					label: 'Wait for TRT feedback (ms)',
					default: 600,
					min: 200,
					max: 5000,
				},
				{
					id: 'durationSeconds',
					type: 'number',
					label: 'Duration override (0 = pull from Mitti)',
					default: 0,
					min: 0,
					max: 86400,
				},
			],
			callback: async (event) => {
				await self.runSetCueDurationFromMitti(event.options, { requireSubCue: false })
			},
		},
		mitti_pull_trt_sub: {
			name: 'Pull Mitti TRT into ROS sub-cue duration',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Sub-cue / Row to update',
					default: '',
					choices: subCueChoices,
				},
				{
					id: 'cueNumber',
					type: 'number',
					label: 'Mitti cue number to sample',
					default: 1,
					min: 1,
					max: 999,
				},
				{
					id: 'restoreCueNumber',
					type: 'number',
					label: 'Restore Mitti cue after sample (0 = last known current)',
					default: 0,
					min: 0,
					max: 999,
				},
				{
					id: 'sampleMs',
					type: 'number',
					label: 'Wait for TRT feedback (ms)',
					default: 600,
					min: 200,
					max: 5000,
				},
				{
					id: 'durationSeconds',
					type: 'number',
					label: 'Duration override (0 = pull from Mitti)',
					default: 0,
					min: 0,
					max: 86400,
				},
			],
			callback: async (event) => {
				await self.runSetCueDurationFromMitti(event.options, { requireSubCue: true })
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
					await self.clearMittiArm()
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
