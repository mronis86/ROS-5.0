module.exports = function (self) {
	const cueChoices = self.scheduleItems.map((item) => {
		const cue = item.customFields?.cue ?? `CUE ${item.id}`
		const label = `${cue}: ${item.segmentName || 'Untitled'}`
		return { id: String(item.id), label }
	})

	self.setActionDefinitions({
		load_cue: {
			name: 'Load Cue',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Cue / Row',
					default: '',
					choices: cueChoices.length > 0 ? cueChoices : [{ id: '', label: 'No cues - configure Event ID first' }],
				},
			],
			callback: async (event) => {
				const eventId = self.config?.eventId
				const itemId = event.options.itemId
				if (!eventId || !itemId) {
					self.log('warn', 'Load Cue: Event ID and Cue are required')
					return
				}
				try {
					const item = self.scheduleItems.find((s) => String(s.id) === String(itemId))
					const cueIs = item?.customFields?.cue ?? `CUE ${itemId}`
					const dur = item
						? (item.durationHours || 0) * 3600 + (item.durationMinutes || 0) * 60 + (item.durationSeconds || 0)
						: 300
					await self.apiPost('/api/cues/load', {
						event_id: eventId,
						item_id: parseInt(itemId),
						user_id: 'companion',
						cue_is: cueIs,
						duration_seconds: dur || 300,
					})
					await self.fetchActiveTimer(eventId)
					self.updateVariableValues()
					self.updateFeedbacks()
					self.log('info', `Loaded cue ${cueIs}`)
				} catch (err) {
					self.log('error', `Load Cue failed: ${err.message}`)
				}
			},
		},
		start_timer: {
			name: 'Start Timer',
			options: [],
			callback: async () => {
				const eventId = self.config?.eventId
				if (!eventId) {
					self.log('warn', 'Start Timer: Event ID is required')
					return
				}
				try {
					await self.fetchActiveTimer(eventId)
					const itemId = self.activeTimer?.item_id
					if (!itemId) {
						self.log('warn', 'Start Timer: No cue loaded. Load a cue first.')
						return
					}
					await self.apiPost('/api/timers/start', {
						event_id: eventId,
						item_id: parseInt(itemId),
						user_id: 'companion',
					})
					await self.fetchActiveTimer(eventId)
					self.updateVariableValues()
					self.updateFeedbacks()
					self.log('info', 'Timer started')
				} catch (err) {
					self.log('error', `Start Timer failed: ${err.message}`)
				}
			},
		},
		stop_timer: {
			name: 'Stop Timer',
			options: [],
			callback: async () => {
				const eventId = self.config?.eventId
				if (!eventId) {
					self.log('warn', 'Stop Timer: Event ID is required')
					return
				}
				try {
					await self.fetchActiveTimer(eventId)
					const itemId = self.activeTimer?.item_id
					if (!itemId) {
						self.log('warn', 'Stop Timer: No active timer')
						return
					}
					await self.apiPost('/api/timers/stop', {
						event_id: eventId,
						item_id: parseInt(itemId),
					})
					await self.fetchActiveTimer(eventId)
					self.updateVariableValues()
					self.updateFeedbacks()
					self.log('info', 'Timer stopped')
				} catch (err) {
					self.log('error', `Stop Timer failed: ${err.message}`)
				}
			},
		},
		reset_timer: {
			name: 'Reset Timer',
			options: [],
			callback: async () => {
				const eventId = self.config?.eventId
				if (!eventId) {
					self.log('warn', 'Reset Timer: Event ID is required')
					return
				}
				try {
					await self.apiPost('/api/timers/reset', { event_id: eventId })
					await self.fetchActiveTimer(eventId)
					self.updateVariableValues()
					self.updateFeedbacks()
					self.log('info', 'Timer reset')
				} catch (err) {
					self.log('error', `Reset Timer failed: ${err.message}`)
				}
			},
		},
		// Sub-timer actions (like OSC /subtimer/cue/5/start and /subtimer/cue/5/stop)
		start_subtimer: {
			name: 'Start Sub-Timer',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Cue / Row',
					default: '',
					choices: cueChoices.length > 0 ? cueChoices : [{ id: '', label: 'No cues - configure Event ID first' }],
				},
			],
			callback: async (event) => {
				const eventId = self.config?.eventId
				const itemId = event.options.itemId
				if (!eventId || !itemId) {
					self.log('warn', 'Start Sub-Timer: Event ID and Cue are required')
					return
				}
				try {
					const item = self.scheduleItems.find((s) => String(s.id) === String(itemId))
					if (!item) {
						self.log('warn', 'Start Sub-Timer: Cue not found')
						return
					}
					const dur = (item.durationHours || 0) * 3600 + (item.durationMinutes || 0) * 60 + (item.durationSeconds || 0) || 300
					const rowNumber = self.scheduleItems.findIndex((s) => String(s.id) === String(itemId)) + 1
					const cueDisplay = item.customFields?.cue ?? `CUE ${itemId}`
					const timerId = item.timerId || `SUB${itemId}`
					await self.apiPost('/api/sub-cue-timers', {
						event_id: eventId,
						item_id: parseInt(itemId),
						user_id: 'companion',
						user_name: 'Companion',
						user_role: 'OPERATOR',
						duration_seconds: dur,
						row_number: rowNumber,
						cue_display: cueDisplay,
						timer_id: timerId,
						is_active: true,
						is_running: true,
						started_at: new Date().toISOString(),
					})
					self.updateVariableValues()
					self.updateFeedbacks()
					self.log('info', `Sub-timer started: ${cueDisplay}`)
				} catch (err) {
					self.log('error', `Start Sub-Timer failed: ${err.message}`)
				}
			},
		},
		stop_subtimer: {
			name: 'Stop Sub-Timer',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Cue (or All)',
					default: '',
					choices: [{ id: '', label: 'All sub-timers' }, ...cueChoices],
				},
			],
			callback: async (event) => {
				const eventId = self.config?.eventId
				if (!eventId) {
					self.log('warn', 'Stop Sub-Timer: Event ID is required')
					return
				}
				try {
					const itemId = event.options.itemId
					await self.apiPut('/api/sub-cue-timers/stop', {
						event_id: eventId,
						...(itemId ? { item_id: parseInt(itemId) } : {}),
					})
					self.updateVariableValues()
					self.updateFeedbacks()
					self.log('info', itemId ? 'Sub-timer stopped' : 'All sub-timers stopped')
				} catch (err) {
					self.log('error', `Stop Sub-Timer failed: ${err.message}`)
				}
			},
		},
		// Timer duration adjust (+/- 1 min, +/- 5 min) - like web UI buttons
		adjust_timer_plus_1: {
			name: 'Timer +1 min',
			options: [],
			callback: async () => {
				await adjustTimerDuration(self, 60)
			},
		},
		adjust_timer_minus_1: {
			name: 'Timer -1 min',
			options: [],
			callback: async () => {
				await adjustTimerDuration(self, -60)
			},
		},
		adjust_timer_plus_5: {
			name: 'Timer +5 min',
			options: [],
			callback: async () => {
				await adjustTimerDuration(self, 300)
			},
		},
		adjust_timer_minus_5: {
			name: 'Timer -5 min',
			options: [],
			callback: async () => {
				await adjustTimerDuration(self, -300)
			},
		},
	})
}

async function adjustTimerDuration(self, secondsDelta) {
	const eventId = self.config?.eventId
	if (!eventId) {
		self.log('warn', 'Timer adjust: Event ID is required')
		return
	}
	try {
		await self.fetchActiveTimer(eventId)
		const itemId = self.activeTimer?.item_id
		if (!itemId) {
			self.log('warn', 'Timer adjust: No active timer loaded')
			return
		}
		const currentDur = self.activeTimer.duration_seconds ?? 300
		const item = self.scheduleItems.find((s) => String(s.id) === String(itemId))
		const fallbackDur = item
			? (item.durationHours || 0) * 3600 + (item.durationMinutes || 0) * 60 + (item.durationSeconds || 0)
			: 300
		const current = currentDur || fallbackDur || 300
		const newDur = Math.max(0, current + secondsDelta)
		await self.apiPut(`/api/active-timers/${eventId}/${itemId}/duration`, {
			duration_seconds: newDur,
		})
		await self.fetchActiveTimer(eventId)
		self.updateVariableValues()
		self.updateFeedbacks()
		const sign = secondsDelta > 0 ? '+' : ''
		self.log('info', `Timer adjusted ${sign}${Math.abs(secondsDelta / 60)} min`)
	} catch (err) {
		self.log('error', `Timer adjust failed: ${err.message}`)
	}
}
