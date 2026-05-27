module.exports = function (self) {
	const cueChoices = (self.scheduleItems || []).map((item) => {
		const cueDisplay = self.formatCueDisplay
			? self.formatCueDisplay(item.customFields?.cue, item.id)
			: (item.customFields?.cue ?? `CUE ${item.id}`)
		const label = `${cueDisplay}: ${item.segmentName || 'Untitled'}`
		return { id: String(item.id), label }
	})

	self.setActionDefinitions({
		arm_resolume_sync: {
			name: 'Arm Resolume sync (load cue + listen)',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Cue / Row',
					default: '',
					choices:
						cueChoices.length > 0 ? cueChoices : [{ id: '', label: 'No cues - configure Event ID first' }],
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
			],
			callback: async (event) => {
				const eventId = self.config?.eventId
				const itemId = event.options.itemId
				const layer = Math.max(1, parseInt(event.options.layer, 10) || 1)
				const clip = Math.max(1, parseInt(event.options.clip, 10) || 1)
				if (!eventId || !itemId) {
					self.log('warn', 'Arm Resolume: Event ID and Cue are required')
					return
				}
				try {
					await self.loadCueForResolume(eventId, itemId)
					self.setResolumeArm({ itemId: String(itemId), layer, clip })
					self.ensureOscListener()
					self.updateVariableValues()
					self.checkFeedbacks('resolume_armed')
					self.log('info', `Resolume sync armed for cue ${itemId} (layer ${layer}, clip ${clip})`)
				} catch (err) {
					self.log('error', `Arm Resolume failed: ${err.message}`)
				}
			},
		},
		disarm_resolume_sync: {
			name: 'Disarm Resolume sync',
			options: [],
			callback: async () => {
				self.clearResolumeArm()
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
					self.clearResolumeArm()
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
					label: 'Cue / Row',
					default: '',
					choices:
						cueChoices.length > 0 ? cueChoices : [{ id: '', label: 'No cues - configure Event ID first' }],
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
					label: 'Cue / Row',
					default: '',
					choices:
						cueChoices.length > 0 ? cueChoices : [{ id: '', label: 'No cues - configure Event ID first' }],
				},
			],
			callback: async (event) => {
				const eventId = self.config?.eventId
				const itemId = event.options.itemId
				if (!eventId || !itemId) return
				try {
					await self.loadCueForResolume(eventId, itemId)
					self.log('info', `Loaded cue ${itemId}`)
				} catch (err) {
					self.log('error', `Load Cue failed: ${err.message}`)
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
					self.clearResolumeArm()
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
