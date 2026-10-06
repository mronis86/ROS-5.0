const { InstanceStatus } = require('@companion-module/base')

module.exports = function (self) {
	const eventId =
		typeof self.normalizeEventId === 'function'
			? self.normalizeEventId(self.config?.eventId)
			: String(self.config?.eventId || '').trim()
	const mainCues = self.getRegularCues()
	const subCues = self.getSubCues()
	const day = self.config?.day || 1
	let regularEmpty = 'No main cues — set Event ID in module config, then Save'
	if (eventId && (self.scheduleItems || []).length === 0) {
		regularEmpty = `No cues loaded for day ${day} — check Event ID, Day, API URL (see Companion log)`
	} else if (eventId && mainCues.length === 0) {
		regularEmpty = `Event loaded but 0 main cues on day ${day} (only sub-cues?) — try another Day`
	}
	const regularCueChoices = self.buildCueDropdownChoices(mainCues, regularEmpty)
	const subCueChoices = self.buildCueDropdownChoices(
		subCues,
		'No sub-cues — add indented rows in Run of Show'
	)

	const cueIndexOption = {
		id: 'cueIndex',
		type: 'number',
		label: 'AV-Playout cue index (0 = current / selected)',
		default: 0,
		min: 0,
		max: 999,
	}

	self.setActionDefinitions({
		reload_cues: {
			name: 'Reload cues from API',
			options: [],
			callback: async () => {
				try {
					await self.fetchData()
					self.updateActions()
					self.updatePresets()
					self.updateVariableValues()
					if (typeof self.checkAllFeedbacks === 'function') self.checkAllFeedbacks()
					const n = self.getRegularCues().length
					self.log('info', `Reload complete — ${n} main cue(s)`)
					if (n === 0) {
						self.updateStatus(
							InstanceStatus.Ok,
							self.avConnected
								? `AV-Playout OK · no main cues for day ${self.config?.day || 1}`
								: `No main cues for day ${self.config?.day || 1}`
						)
					} else {
						self.updateStatus(InstanceStatus.Ok, `${n} main cue(s)`)
					}
				} catch (err) {
					self.log('error', `Reload cues failed: ${err.message}`)
					self.updateStatus(InstanceStatus.ConnectionFailure, err.message || 'Reload failed')
				}
			},
		},

		// ── Direct AV-Playout transport (no ROS cue / layer required) ──
		av_play: {
			name: 'AV Direct: Play / Fire',
			options: [cueIndexOption],
			callback: async (event) => {
				try {
					await self.playAvDirect({ cueIndex: event.options?.cueIndex })
				} catch (err) {
					self.log('error', `Play/Fire failed: ${err.message}`)
				}
			},
		},
		av_pause: {
			name: 'AV Direct: Pause',
			options: [],
			callback: async () => {
				try {
					await self.pauseAvDirect()
				} catch (err) {
					self.log('error', `Pause failed: ${err.message}`)
				}
			},
		},
		av_resume: {
			name: 'AV Direct: Resume',
			options: [],
			callback: async () => {
				try {
					await self.resumeAvDirect()
				} catch (err) {
					self.log('error', `Resume failed: ${err.message}`)
				}
			},
		},
		av_load: {
			name: 'AV Direct: Load (cue up)',
			options: [cueIndexOption],
			callback: async (event) => {
				try {
					await self.loadAvDirect({ cueIndex: event.options?.cueIndex })
				} catch (err) {
					self.log('error', `Load failed: ${err.message}`)
				}
			},
		},
		stop_avplayout_playback: {
			name: 'AV Direct: Stop',
			options: [],
			callback: async () => {
				await self.stopAvPlayback({ reason: 'manual' })
			},
		},
		arm_avplayout_current: {
			name: 'Arm AV-Playout (current — no cue select)',
			options: [
				cueIndexOption,
				{
					id: 'triggerOnArm',
					type: 'checkbox',
					label: 'Fire AV-Playout on arm',
					default: true,
				},
			],
			callback: async (event) => {
				await self.runArmAvPlayoutCurrent(event.options || {})
			},
		},
		send_avplayout_time: {
			name: 'Send Time (current telemetry → ROS)',
			options: [],
			callback: async () => {
				await self.sendAvPlayoutTime()
			},
		},

		// ── ROS-tied sync (pick a cue) ──
		arm_avplayout_sync: {
			name: 'Arm AV-Playout sync (load cue + listen)',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Main cue / Row',
					default: '',
					choices: regularCueChoices,
				},
				{
					id: 'cueIndex',
					type: 'number',
					label: 'AV-Playout cue index (1-based)',
					default: 1,
					min: 1,
					max: 999,
				},
				{
					id: 'triggerOnArm',
					type: 'checkbox',
					label: 'Fire AV-Playout on arm',
					default: true,
				},
			],
			callback: async (event) => {
				await self.runArmAvPlayoutSync(event.options, { requireSubCue: false })
			},
		},
		arm_avplayout_sub_sync: {
			name: 'Arm AV-Playout sync (sub-cue — loads parent + listen)',
			options: [
				{
					id: 'itemId',
					type: 'dropdown',
					label: 'Sub-cue / Row',
					default: '',
					choices: subCueChoices,
				},
				{
					id: 'cueIndex',
					type: 'number',
					label: 'AV-Playout cue index (1-based)',
					default: 1,
					min: 1,
					max: 999,
				},
				{
					id: 'triggerOnArm',
					type: 'checkbox',
					label: 'Fire AV-Playout on arm',
					default: true,
				},
			],
			callback: async (event) => {
				await self.runArmAvPlayoutSync(event.options, { requireSubCue: true })
			},
		},
		disarm_avplayout_sync: {
			name: 'Disarm AV-Playout sync',
			options: [
				{
					id: 'stopPlayback',
					type: 'checkbox',
					label: 'Also stop AV-Playout / Caspar',
					default: true,
				},
			],
			callback: async (event) => {
				await self.clearAvArm({ stopPlayback: event.options?.stopPlayback !== false })
				self.log('info', 'AV-Playout sync disarmed')
			},
		},
		end_avplayout_sync: {
			name: 'End AV-Playout sync (clear time source)',
			options: [
				{
					id: 'stopPlayback',
					type: 'checkbox',
					label: 'Also stop AV-Playout / Caspar',
					default: true,
				},
			],
			callback: async (event) => {
				const eid = self.config?.eventId
				if (!eid) return
				try {
					await self.apiPost('/api/timers/avplayout-end', { event_id: eid })
					await self.clearAvArm({ stopPlayback: event.options?.stopPlayback !== false })
					self.log('info', 'AV-Playout time source cleared')
				} catch (err) {
					self.log('error', `End AV-Playout sync failed: ${err.message}`)
				}
			},
		},
		manual_avplayout_align: {
			name: 'Manual AV-Playout align (test without telemetry)',
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
				const eid = self.config?.eventId
				const itemId = event.options.itemId
				if (!eid || !itemId) {
					self.log('warn', 'Manual align: Event ID and Cue are required')
					return
				}
				try {
					const item = self.scheduleItems.find((s) => String(s.id) === String(itemId))
					const cueIs = item?.customFields?.cue ?? `CUE ${itemId}`
					const dur = parseInt(event.options.durationSeconds, 10) || 300
					const rem = parseInt(event.options.remainingSeconds, 10)
					await self.postAvAlign({
						eventId: eid,
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
		stop_timer: {
			name: 'Stop Timer (+ AV-Playout)',
			options: [],
			callback: async () => {
				const eid = self.config?.eventId
				if (!eid) return
				try {
					await self.fetchActiveTimer(eid)
					const itemId = self.activeTimer?.item_id
					if (itemId) {
						await self.apiPost('/api/timers/stop', {
							event_id: eid,
							item_id: parseInt(itemId, 10),
						})
					}
					await self.apiPost('/api/timers/avplayout-end', { event_id: eid }).catch(() => {})
					await self.clearAvArm({ stopPlayback: true })
					await self.fetchActiveTimer(eid)
					self.updateVariableValues()
					self.log('info', 'Timer stopped (+ AV-Playout when enabled)')
				} catch (err) {
					self.log('error', `Stop Timer failed: ${err.message}`)
				}
			},
		},
	})
}
