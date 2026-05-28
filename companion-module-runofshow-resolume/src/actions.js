module.exports = function (self) {
	const regularCueChoices = self.buildCueDropdownChoices(
		self.getRegularCues(),
		'No main cues — configure Event ID first'
	)
	const subCueChoices = self.buildCueDropdownChoices(
		self.getSubCues(),
		'No sub-cues — add indented rows in Run of Show'
	)
	const allCueChoices = self.buildCueDropdownChoices(self.scheduleItems || [])

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
				const eventId = self.config?.eventId
				const itemId = event.options.itemId
				const layer = Math.max(1, parseInt(event.options.layer, 10) || 1)
				const clip = Math.max(1, parseInt(event.options.clip, 10) || 1)
				const triggerOnArm = event.options.triggerOnArm === true
				const triggerType = event.options.triggerType === 'column' ? 'column' : 'clip'
				const column = Math.max(1, parseInt(event.options.column, 10) || 1)
				if (!eventId || !itemId) {
					self.log('warn', 'Arm Resolume: Event ID and Cue are required')
					return
				}
				const item = self.scheduleItems.find((s) => String(s.id) === String(itemId))
				if (item?.isIndented) {
					self.log('warn', 'Arm Resolume: use a main cue row, not a sub-cue')
					return
				}
				try {
					await self.loadCueForResolume(eventId, itemId)
					self.setResolumeArm({ itemId: String(itemId), layer, clip })
					await self.notifyResolumeArm(itemId)
					if (triggerOnArm) {
						self.sendResolumeTrigger({ triggerType, layer, clip, column })
					}
					self.ensureOscListener()
					self.updateVariableValues()
					self.checkFeedbacks('resolume_armed')
					self.log(
						'info',
						`Resolume sync armed for cue ${itemId} (watch L${layer} C${clip}${triggerOnArm ? `; trigger ${triggerType}${triggerType === 'column' ? ` ${column}` : ''}` : ''})`
					)
				} catch (err) {
					self.log('error', `Arm Resolume failed: ${err.message}`)
				}
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
		start_subtimer: {
			name: 'Start Sub-Cue Timer',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Sub-cue / Row',
					default: '',
					choices: subCueChoices,
				},
			],
			callback: async (event) => {
				const eventId = self.config?.eventId
				const itemId = event.options.itemId
				if (!eventId || !itemId) {
					self.log('warn', 'Start Sub-Cue: Event ID and sub-cue are required')
					return
				}
				try {
					const item = self.scheduleItems.find((s) => String(s.id) === String(itemId))
					if (!item) {
						self.log('warn', 'Start Sub-Cue: row not found')
						return
					}
					if (!item.isIndented) {
						self.log('warn', 'Start Sub-Cue: row is not a sub-cue (not indented)')
						return
					}
					const dur =
						(item.durationHours || 0) * 3600 +
						(item.durationMinutes || 0) * 60 +
						(item.durationSeconds || 0)
					const durationSeconds = dur != null && dur >= 0 ? dur : 300
					const rowNumber = self.scheduleItems.findIndex((s) => String(s.id) === String(itemId)) + 1
					const cueDisplay = self.formatCueDisplay
						? self.formatCueDisplay(item.customFields?.cue, itemId)
						: (item.customFields?.cue ?? `CUE ${itemId}`)
					const timerId = item.timerId || `SUB${itemId}`
					await self.apiPost('/api/sub-cue-timers', {
						event_id: eventId,
						item_id: parseInt(itemId, 10),
						user_id: 'companion-resolume',
						user_name: 'Companion (Resolume)',
						user_role: 'OPERATOR',
						duration_seconds: durationSeconds,
						row_number: rowNumber,
						cue_display: cueDisplay,
						timer_id: timerId,
						is_active: true,
						is_running: true,
						started_at: new Date().toISOString(),
					})
					await self.fetchSubCueTimer(eventId)
					self.updateVariableValues()
					self.checkAllFeedbacks()
					self.log('info', `Sub-cue timer started: ${cueDisplay}`)
				} catch (err) {
					self.log('error', `Start Sub-Cue failed: ${err.message}`)
				}
			},
		},
		stop_subtimer: {
			name: 'Stop Sub-Cue Timer',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Sub-cue (or All)',
					default: '',
					choices: [{ id: '', label: 'All sub-cue timers' }, ...subCueChoices],
				},
			],
			callback: async (event) => {
				const eventId = self.config?.eventId
				if (!eventId) {
					self.log('warn', 'Stop Sub-Cue: Event ID is required')
					return
				}
				try {
					const itemId = event.options.itemId
					await self.apiPut('/api/sub-cue-timers/stop', {
						event_id: eventId,
						...(itemId ? { item_id: parseInt(itemId, 10) } : {}),
					})
					await self.fetchSubCueTimer(eventId)
					self.updateVariableValues()
					self.checkAllFeedbacks()
					self.log('info', itemId ? `Sub-cue timer stopped: ${itemId}` : 'All sub-cue timers stopped')
				} catch (err) {
					self.log('error', `Stop Sub-Cue failed: ${err.message}`)
				}
			},
		},
		resolume_set_cue_duration: {
			name: 'Set cue duration from Resolume clip',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Cue / Row to update',
					default: '',
					choices: allCueChoices,
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
				const eventId = self.config?.eventId
				const itemId = event.options.itemId
				const layer = Math.max(1, parseInt(event.options.layer, 10) || 1)
				const clip = Math.max(1, parseInt(event.options.clip, 10) || 1)
				if (!eventId || !itemId) {
					self.log('warn', 'Set cue duration: Event ID and cue are required')
					return
				}
				try {
					let dur = parseInt(event.options.durationSeconds, 10)
					if (!Number.isFinite(dur) || dur < 1) {
						dur = await self.sampleClipDurationFromOsc(layer, clip, {
							waitMs: event.options.sampleMs,
							triggerClip: event.options.triggerClip === true,
							itemId: String(itemId),
						})
					}
					const applied = await self.putCueDurationSeconds(eventId, itemId, dur)
					const cueDisplay = self.formatCueDisplay
						? self.formatCueDisplay(
								self.scheduleItems.find((s) => String(s.id) === String(itemId))?.customFields?.cue,
								itemId
							)
						: `cue ${itemId}`
					self.log(
						'info',
						`Updated ${cueDisplay} duration to ${applied}s from Resolume L${layer} C${clip} (web app schedule row)`
					)
				} catch (err) {
					self.log('error', `Set cue duration failed: ${err.message}`)
				}
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
