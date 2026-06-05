const { InstanceBase, runEntrypoint, InstanceStatus, combineRgb } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')
const {
	positionAddress,
	connectAddress,
	columnConnectAddress,
	matchesAddress,
	inferDurationFromSamples,
	remainingFromPosition,
	remainingFromPositionPrecise,
	createUdpPort,
	sendOsc,
} = require('./resolumeOsc')

class RunOfShowResolumeInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.events = []
		this.scheduleItems = []
		this.indentedCueIds = new Set()
		this.activeTimer = null
		this.resolumeArm = null
		this.oscPort = null
		this.lastInferredDuration = null
		this.alignInFlight = false
		this.periodicAlignInterval = null
		this.lastSyncAt = null
		this.lastSyncReason = ''
		this.lastSyncRemaining = null
		this.syncCount = 0
		this.syncPulseActive = false
		this.syncPulseTimeout = null
	}

	async init(config) {
		await this.applyConfig(config, true)
	}

	async destroy() {
		this.stopPeriodicAlign()
		this.cancelDurationSample()
		if (this.syncPulseTimeout) clearTimeout(this.syncPulseTimeout)
		this.closeOscListener()
		this.resolumeArm = null
	}

	async configUpdated(config) {
		await this.applyConfig(config, false)
	}

	/** Fast init: OSC first, API fetch with timeout so Companion does not hang on "Connecting". */
	async applyConfig(config, isFirstInit) {
		this.config = config
		this.updateStatus(InstanceStatus.Connecting)
		if (isFirstInit) {
			this.ensureOscListener()
		} else {
			this.closeOscListener()
			this.ensureOscListener()
		}
		try {
			await this.fetchData()
		} catch (err) {
			this.log(
				'warn',
				`API fetch failed (${err.message}). Check API URL + Event ID. OSC listener is still active.`
			)
		}
		this.updateActions()
		await this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.updateVariableValues()
		this.checkAllFeedbacks()
		this.updateStatus(InstanceStatus.Ok)
	}

	getApiUrl() {
		const url = (this.config?.apiUrl || '').trim().replace(/\/+$/, '')
		return url || 'https://ros-50-production.up.railway.app'
	}

	getOscListenPort() {
		const p = parseInt(this.config?.oscListenPort, 10)
		return Number.isFinite(p) && p > 0 ? p : 7002
	}

	getSampleDelayMs() {
		const ms = parseInt(this.config?.sampleDelayMs, 10)
		return Number.isFinite(ms) && ms >= 30 ? ms : 80
	}

	getFollowUpAlignMs() {
		const ms = parseInt(this.config?.followUpAlignMs, 10)
		return Number.isFinite(ms) && ms >= 0 ? ms : 400
	}

	/** align_zero = snap to 0 + overtime. stop = stop timer. none = stop timer (do nothing else). keep_running = release lock only. */
	getClipEndAction() {
		const a = String(this.config?.clipEndAction || '').trim()
		if (a === 'stop' || a === 'none' || a === 'keep_running') return a
		// Legacy checkbox
		if (this.config?.autoStopAtClipEnd === true || this.config?.autoStopAtClipEnd === 'true') return 'stop'
		return 'align_zero'
	}

	getNetworkDelayMs() {
		const ms = parseInt(this.config?.networkDelayMs, 10)
		return Number.isFinite(ms) && ms >= 0 ? Math.min(15000, ms) : 800
	}

	getScheduleDurationSeconds(itemId) {
		const item = this.scheduleItems.find((s) => String(s.id) === String(itemId))
		if (!item) return null
		const d =
			(item.durationHours || 0) * 3600 + (item.durationMinutes || 0) * 60 + (item.durationSeconds || 0)
		return d > 0 ? d : null
	}

	resolveClipDuration(arm) {
		const fromSamples = inferDurationFromSamples(arm.samples)
		if (fromSamples) return { duration: fromSamples, source: 'osc-slope' }
		const schedule =
			arm.scheduleDurationSeconds ||
			this.getScheduleDurationSeconds(arm.itemId) ||
			(this.activeTimer?.duration_seconds > 0 ? this.activeTimer.duration_seconds : null)
		if (schedule) return { duration: schedule, source: 'schedule' }
		return null
	}

	recordSyncSuccess(reason, remainingSeconds, durationSeconds) {
		this.lastSyncAt = Date.now()
		this.lastSyncReason = reason
		this.lastSyncRemaining = remainingSeconds
		this.lastInferredDuration = durationSeconds
		this.syncCount = (this.syncCount || 0) + 1
		if (this.resolumeArm) {
			this.resolumeArm.phase = 'aligned'
			this.resolumeArm.inferredDuration = durationSeconds
		}
		this.updateVariableValues()
		this.checkFeedbacks('resolume_armed', 'resolume_aligned', 'resolume_sync_pulse')
		if (this.syncPulseTimeout) clearTimeout(this.syncPulseTimeout)
		this.syncPulseActive = true
		this.checkFeedbacks('resolume_sync_pulse')
		this.syncPulseTimeout = setTimeout(() => {
			this.syncPulseActive = false
			this.checkFeedbacks('resolume_sync_pulse')
		}, 2000)
	}

	getClipEndPositionThreshold() {
		const t = Number(this.config?.clipEndPositionThreshold)
		return Number.isFinite(t) && t > 0.9 && t <= 1 ? t : 0.995
	}

	getPeriodicAlignIntervalSeconds() {
		const s = parseInt(this.config?.periodicAlignIntervalSeconds, 10)
		return Number.isFinite(s) && s >= 0 ? s : 10
	}

	getEstimatedDriftSeconds() {
		const arm = this.resolumeArm
		if (!arm?.inferredDuration || arm.lastPosition == null) return null
		const resolumeRem = remainingFromPositionPrecise(arm.inferredDuration, arm.lastPosition, false)
		const rosRem = this.getRosRemainingSeconds()
		if (rosRem == null) return null
		return Math.round((rosRem - resolumeRem) * 10) / 10
	}

	getRosRemainingSeconds() {
		const t = this.activeTimer
		if (!t?.is_running || !t.started_at || t.duration_seconds == null) return null
		const startedMs = new Date(t.started_at).getTime()
		if (!Number.isFinite(startedMs) || startedMs > Date.now() + 86400000) return null
		return Math.max(0, t.duration_seconds - (Date.now() - startedMs) / 1000)
	}

	stopPeriodicAlign() {
		if (this.periodicAlignInterval) {
			clearInterval(this.periodicAlignInterval)
			this.periodicAlignInterval = null
		}
	}

	startPeriodicAlign() {
		this.stopPeriodicAlign()
		const sec = this.getPeriodicAlignIntervalSeconds()
		if (sec <= 0) return
		const self = this
		this.periodicAlignInterval = setInterval(() => {
			const run = async () => {
				const arm = self.resolumeArm
				if (!arm || arm.phase !== 'aligned' || !arm.inferredDuration || arm.endTriggered) return
				const eventId = self.config?.eventId
				if (eventId) {
					try {
						await self.fetchActiveTimer(eventId)
					} catch (_) {}
				}
				const nowMs = Date.now()
				// Clip looped to start (position≈0) while we were near end — would reset ROS to full duration
				if (
					arm.lastPosition < 0.02 &&
					self.lastSyncRemaining != null &&
					self.lastSyncRemaining <= 20
				) {
					self.log('info', 'Skipping periodic align — position at clip start after near-end playback')
					return
				}
				const resolumeRem = remainingFromPositionPrecise(arm.inferredDuration, arm.lastPosition, false)
				const rosRem = self.getRosRemainingSeconds()
				const drift =
					rosRem != null
						? Math.round(Math.abs(rosRem - resolumeRem) * 10) / 10
						: null
				self.log(
					'info',
					`Periodic re-sync every ${sec}s (rem ${resolumeRem}s${drift != null ? `, drift ${drift}s` : ''})`
				)
				await self.triggerResolumeAlign(
					arm.inferredDuration,
					resolumeRem,
					nowMs,
					true,
					'periodic'
				)
			}
			run().catch((err) => self.log('warn', `Periodic align failed: ${err.message}`))
		}, sec * 1000)
	}

	getResolumeSendHost() {
		const host = String(this.config?.resolumeSendHost || '').trim()
		return host || '127.0.0.1'
	}

	getResolumeSendPort() {
		const p = parseInt(this.config?.resolumeSendPort, 10)
		return Number.isFinite(p) && p > 0 ? p : 7000
	}

	sendResolumeTrigger({ triggerType, layer, clip, column }) {
		const host = this.getResolumeSendHost()
		const port = this.getResolumeSendPort()
		let address = ''
		if (triggerType === 'column') {
			address = columnConnectAddress(Math.max(1, parseInt(column, 10) || 1))
		} else {
			address = connectAddress(Math.max(1, parseInt(layer, 10) || 1), Math.max(1, parseInt(clip, 10) || 1))
		}
		sendOsc(host, port, address, 1)
		this.log('info', `Sent Resolume OSC trigger -> ${host}:${port} ${address}`)
	}

	getFetchTimeoutMs() {
		const ms = parseInt(this.config?.apiFetchTimeoutMs, 10)
		return Number.isFinite(ms) && ms >= 2000 ? Math.min(ms, 30000) : 8000
	}

	async fetch(url, options = {}) {
		const baseUrl = this.getApiUrl()
		const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`
		const timeoutMs = this.getFetchTimeoutMs()
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeoutMs)
		try {
			const res = await fetch(fullUrl, {
				...options,
				signal: controller.signal,
				headers: { 'Content-Type': 'application/json', ...options.headers },
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const text = await res.text()
			return text ? JSON.parse(text) : null
		} catch (err) {
			if (err?.name === 'AbortError') {
				throw new Error(`Request timed out after ${timeoutMs}ms`)
			}
			throw err
		} finally {
			clearTimeout(timer)
		}
	}

	async apiPost(path, body) {
		return this.fetch(path, {
			method: 'POST',
			body: JSON.stringify(body),
		})
	}

	async apiPut(path, body) {
		return this.fetch(path, {
			method: 'PUT',
			body: JSON.stringify(body),
		})
	}

	cancelDurationSample() {
		const req = this.durationSampleRequest
		if (!req) return
		if (req.timer) clearTimeout(req.timer)
		this.durationSampleRequest = null
	}

	/** Sample Resolume clip length from OSC position slope (clip should be playing). */
	sampleClipDurationFromOsc(layer, clip, options = {}) {
		const waitMs = Math.max(200, parseInt(options.waitMs, 10) || 600)
		const triggerClip = options.triggerClip !== false
		const itemId = options.itemId
		const column = Math.max(1, parseInt(options.column, 10) || 1)

		this.ensureOscListener()
		this.cancelDurationSample()

		if (triggerClip) {
			this.sendResolumeTrigger({ triggerType: 'clip', layer, clip, column })
		}

		const posAddr = positionAddress(layer, clip)
		this.log('info', `Sampling clip duration L${layer} C${clip} for ${waitMs}ms…`)

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				const req = this.durationSampleRequest
				this.durationSampleRequest = null
				const samples = req?.samples || []
				let duration = inferDurationFromSamples(samples)
				if (!duration && itemId) duration = this.getScheduleDurationSeconds(itemId)
				if (!duration || duration < 1) {
					reject(
						new Error(
							`Could not read clip duration (L${layer} C${clip}). Play the clip in Resolume or set duration manually.`
						)
					)
					return
				}
				this.lastInferredDuration = duration
				resolve(duration)
			}, waitMs)

			this.durationSampleRequest = {
				positionAddress: posAddr,
				samples: [],
				timer,
				reject,
			}
		})
	}

	async putCueDurationSeconds(eventId, itemId, durationSeconds) {
		const dur = Math.max(1, Math.floor(Number(durationSeconds) || 0))
		await this.apiPut(`/api/active-timers/${eventId}/${itemId}/duration`, {
			duration_seconds: dur,
		})
		await this.fetchRunOfShow(eventId, this.config?.day || 1)
		this.updateVariableValues()
		return dur
	}

	async fetchEvents() {
		const data = await this.fetch('/api/calendar-events')
		this.events = Array.isArray(data) ? data : []
		return this.events
	}

	async fetchIndentedCueIds(eventId) {
		try {
			const rows = await this.fetch(`/api/indented-cues/${eventId}`)
			if (!Array.isArray(rows)) return new Set()
			return new Set(rows.map((r) => String(r.item_id)))
		} catch {
			return new Set()
		}
	}

	isScheduleItemSubCue(item) {
		if (!item) return false
		if (item.isIndented) return true
		return this.indentedCueIds?.has(String(item.id))
	}

	async fetchRunOfShow(eventId, day = 1) {
		const data = await this.fetch(`/api/run-of-show-data/${eventId}`)
		if (!data || !data.schedule_items) {
			this.scheduleItems = []
		this.indentedCueIds = new Set()
			return []
		}
		let items = typeof data.schedule_items === 'string' ? JSON.parse(data.schedule_items) : data.schedule_items
		if (!Array.isArray(items)) items = []
		const dayNum = parseInt(day, 10) || 1
		const indentedIds = await this.fetchIndentedCueIds(eventId)
		this.indentedCueIds = indentedIds
		this.scheduleItems = items
			.filter((item) => (item.day || 1) === dayNum)
			.map((item) => ({
				...item,
				isIndented: !!(item.isIndented || indentedIds.has(String(item.id))),
			}))
		return this.scheduleItems
	}

	async fetchActiveTimer(eventId) {
		try {
			const data = await this.fetch(`/api/active-timers/${eventId}`)
			const row = Array.isArray(data) && data[0] ? data[0] : data
			this.activeTimer = row && row.item_id != null ? row : null
		} catch {
			this.activeTimer = null
		}
		return this.activeTimer
	}

	getRegularCues() {
		return (this.scheduleItems || []).filter((item) => !item.isIndented)
	}

	getSubCues() {
		return (this.scheduleItems || []).filter((item) => !!item.isIndented)
	}

	findParentCueId(itemId) {
		const idx = this.scheduleItems.findIndex((s) => String(s.id) === String(itemId))
		if (idx === -1) return null
		for (let i = idx - 1; i >= 0; i--) {
			const row = this.scheduleItems[i]
			if (row && !row.isIndented) return row.id
		}
		return null
	}

	buildCueDropdownChoices(items, emptyLabel = 'No cues — configure Event ID first') {
		const list = items || []
		if (list.length === 0) return [{ id: '', label: emptyLabel }]
		return list.map((item) => {
			const cueDisplay = this.formatCueDisplay(item.customFields?.cue, item.id)
			return { id: String(item.id), label: `${cueDisplay}: ${item.segmentName || 'Untitled'}` }
		})
	}

	async stopAllSubCueTimers(eventId) {
		if (!eventId) return
		try {
			await this.apiPut('/api/sub-cue-timers/stop', { event_id: eventId })
		} catch (err) {
			this.log('warn', `Stop sub-cue timers: ${err.message}`)
		}
	}

	async fetchData() {
		const eventId = this.config?.eventId
		if (!eventId) {
			this.events = []
			this.scheduleItems = []
		this.indentedCueIds = new Set()
			this.activeTimer = null
			this.log('warn', 'Event ID is empty — set Event ID in module config to load cues')
			return
		}
		await this.fetchEvents()
		await this.fetchRunOfShow(eventId, this.config?.day || 1)
		await this.fetchActiveTimer(eventId)
	}

	formatCueDisplay(raw, itemId) {
		const s = String(raw ?? itemId ?? '').trim()
		if (!s) return `CUE ${itemId}`
		if (/^\d+(\.\d+)?$/.test(s)) return `CUE ${s}`
		if (/^CUE\s+/i.test(s)) return s
		return `CUE ${s}`
	}

	async runArmResolumeSync(options, { requireSubCue }) {
		const eventId = this.config?.eventId
		const itemId = options.itemId
		const layer = Math.max(1, parseInt(options.layer, 10) || 1)
		const clip = Math.max(1, parseInt(options.clip, 10) || 1)
		const triggerOnArm = options.triggerOnArm === true
		const triggerType = options.triggerType === 'column' ? 'column' : 'clip'
		const column = Math.max(1, parseInt(options.column, 10) || 1)
		if (!eventId || !itemId) {
			this.log('warn', 'Arm Resolume: Event ID and cue are required')
			return
		}
		const item = this.scheduleItems.find((s) => String(s.id) === String(itemId))
		const isSub = this.isScheduleItemSubCue(item)
		if (requireSubCue && !isSub) {
			this.log('warn', 'Arm sub-cue: select an indented sub-cue row')
			return
		}
		if (!requireSubCue && isSub) {
			this.log('warn', 'Arm Resolume: use a main cue row, not a sub-cue')
			return
		}
		let loadItemId = itemId
		let armTrackItemId = itemId
		if (requireSubCue) {
			const parentId = this.findParentCueId(itemId)
			if (parentId == null) {
				this.log('warn', 'Arm sub-cue: could not find parent row above this sub-cue')
				return
			}
			loadItemId = parentId
			armTrackItemId = itemId
		}
		try {
			await this.loadCueForResolume(eventId, loadItemId, { forSubCueParent: !!requireSubCue })
			this.setResolumeArm({ itemId: String(armTrackItemId), layer, clip, isSubCue: !!requireSubCue })
			await this.notifyResolumeArm(armTrackItemId, { isSubCue: requireSubCue })
			if (triggerOnArm) {
				this.sendResolumeTrigger({ triggerType, layer, clip, column })
			}
			this.ensureOscListener()
			this.updateVariableValues()
			this.checkFeedbacks('resolume_armed')
			const cueDisplay = this.formatCueDisplay(item?.customFields?.cue, itemId)
			this.log(
				'info',
				`Resolume sync armed for ${requireSubCue ? 'sub-cue' : 'cue'} ${cueDisplay} (watch L${layer} C${clip}; loaded ${loadItemId})`
			)
		} catch (err) {
			this.log('error', `Arm Resolume failed: ${err.message}`)
		}
	}

	async runSetCueDurationFromClip(options, { requireSubCue }) {
		const eventId = this.config?.eventId
		const itemId = options.itemId
		const layer = Math.max(1, parseInt(options.layer, 10) || 1)
		const clip = Math.max(1, parseInt(options.clip, 10) || 1)
		if (!eventId || !itemId) {
			this.log('warn', 'Set cue duration: Event ID and cue are required')
			return
		}
		const item = this.scheduleItems.find((s) => String(s.id) === String(itemId))
		const isSub = this.isScheduleItemSubCue(item)
		if (requireSubCue && !isSub) {
			this.log('warn', 'Set sub-cue duration: select an indented sub-cue row')
			return
		}
		if (!requireSubCue && isSub) {
			this.log('warn', 'Set main cue duration: use the sub-cue duration action for indented rows')
			return
		}
		try {
			let dur = parseInt(options.durationSeconds, 10)
			if (!Number.isFinite(dur) || dur < 1) {
				dur = await this.sampleClipDurationFromOsc(layer, clip, {
					waitMs: options.sampleMs,
					triggerClip: options.triggerClip === true,
					itemId: String(itemId),
				})
			}
			const applied = await this.putCueDurationSeconds(eventId, itemId, dur)
			const cueDisplay = this.formatCueDisplay(item?.customFields?.cue, itemId)
			this.log(
				'info',
				`Updated ${requireSubCue ? 'sub-cue' : 'cue'} ${cueDisplay} duration to ${applied}s from Resolume L${layer} C${clip}`
			)
		} catch (err) {
			this.log('error', `Set cue duration failed: ${err.message}`)
		}
	}

	async loadCueForResolume(eventId, itemId, { forSubCueParent = false } = {}) {
		await this.fetchActiveTimer(eventId)
		await this.stopAllSubCueTimers(eventId)

		const targetId = String(itemId)
		const activeId =
			this.activeTimer?.item_id != null ? String(this.activeTimer.item_id) : null
		const activeRunning =
			this.activeTimer?.is_running === true ||
			this.activeTimer?.timer_state === 'running'

		// Sub-cue Resolume arm: keep parent RUNNING/LOADED — same as native PLAY on indented row
		if (forSubCueParent && activeId === targetId) {
			this.log(
				'info',
				`Sub-cue arm: parent cue ${itemId} left ${activeRunning ? 'RUNNING' : 'LOADED'} (not reloading)`
			)
			return
		}

		if (this.activeTimer?.item_id != null) {
			try {
				await this.apiPost('/api/timers/stop', {
					event_id: eventId,
					item_id: parseInt(this.activeTimer.item_id, 10),
				})
			} catch (stopErr) {
				this.log('warn', `Stop before load: ${stopErr.message}`)
			}
		}
		const item = this.scheduleItems.find((s) => String(s.id) === String(itemId))
		const cueIs = item?.customFields?.cue ?? `CUE ${itemId}`
		const dur = item
			? (item.durationHours || 0) * 3600 + (item.durationMinutes || 0) * 60 + (item.durationSeconds || 0)
			: 300
		await this.apiPost('/api/cues/load', {
			event_id: eventId,
			item_id: parseInt(itemId, 10),
			user_id: 'companion-resolume',
			cue_is: cueIs,
			duration_seconds: dur ?? 300,
		})
		await this.fetchActiveTimer(eventId)
		this.updateVariableValues()
	}

	async notifyResolumeArm(itemId, { isSubCue = false } = {}) {
		const eventId = this.config?.eventId
		if (!eventId || !itemId) return
		try {
			await this.apiPost('/api/timers/resolume-arm', {
				event_id: eventId,
				item_id: parseInt(itemId, 10),
				is_sub_cue: !!isSubCue,
			})
		} catch (err) {
			this.log('warn', `resolume-arm notify failed: ${err.message}`)
		}
	}

	setResolumeArm({ itemId, layer, clip, isSubCue = false }) {
		const scheduleDurationSeconds = this.getScheduleDurationSeconds(itemId)
		this.resolumeArm = {
			itemId: String(itemId),
			isSubCue: !!isSubCue,
			layer,
			clip,
			phase: 'idle',
			samples: [],
			sampleStartMs: 0,
			scheduleDurationSeconds,
			inferredDuration: null,
			lastPosition: 0,
			lastPositionMs: 0,
			endTriggered: false,
			followUpScheduled: false,
			usedScheduleFallback: false,
			oscMsgCount: 0,
			positionAddress: positionAddress(layer, clip),
			connectAddress: connectAddress(layer, clip),
		}
		this.alignInFlight = false
		this.log(
			'info',
			`Watching OSC: ${positionAddress(layer, clip)} (cue duration ${scheduleDurationSeconds ?? 'unknown'}s)`
		)
	}

	async clearResolumeArm() {
		this.stopPeriodicAlign()
		const eventId = this.config?.eventId
		this.resolumeArm = null
		this.alignInFlight = false
		if (eventId) {
			this.apiPost('/api/timers/resolume-disarm', { event_id: eventId }).catch(() => {})
		}
		this.updateVariableValues()
		this.checkFeedbacks('resolume_armed', 'resolume_aligned')
	}

	closeOscListener() {
		const port = this.oscPort
		this.oscPort = null
		if (!port) return
		try {
			port.close()
		} catch (_) {}
	}

	ensureOscListener() {
		if (this.oscPort) return
		const port = this.getOscListenPort()
		const self = this
		try {
			this.oscPort = createUdpPort(
				port,
				(oscMsg) => self.handleOscMessage(oscMsg),
				(err) => self.log('error', `OSC listen error: ${err.message}`)
			)
			this.log('info', `OSC listening on UDP port ${port}`)
		} catch (err) {
			this.log('error', `Failed to start OSC listener on port ${port}: ${err.message}`)
		}
	}

	handleOscMessage(oscMsg) {
		const address = oscMsg?.address
		const args = oscMsg?.args || []
		const value = args[0]?.value

		const durSample = this.durationSampleRequest
		if (durSample && matchesAddress(address, durSample.positionAddress)) {
			const position = Number(value)
			if (Number.isFinite(position)) {
				durSample.samples.push({ timeMs: Date.now(), position })
			}
		}

		if (!this.resolumeArm) return
		const arm = this.resolumeArm

		arm.oscMsgCount = (arm.oscMsgCount || 0) + 1
		if (arm.oscMsgCount <= 5) {
			this.log('info', `OSC #${arm.oscMsgCount}: ${address} = ${value}`)
		}

		if (matchesAddress(address, arm.connectAddress) && Number(value) >= 1) {
			if (arm.phase === 'aligned') return
			arm.phase = 'sampling'
			arm.samples = []
			arm.sampleStartMs = Date.now()
			arm.inferredDuration = null
			arm.endTriggered = false
			return
		}

		if (!matchesAddress(address, arm.positionAddress)) return
		const position = Number(value)
		if (!Number.isFinite(position)) return

		const nowMs = Date.now()
		arm.lastPosition = position
		arm.lastPositionMs = nowMs

		if (arm.phase === 'aligned') {
			arm.refineSamples = arm.refineSamples || []
			arm.refineSamples.push({ timeMs: nowMs, position })
			if (arm.refineSamples.length > 20) arm.refineSamples.shift()
			const refined = inferDurationFromSamples(arm.refineSamples)
			if (refined && Math.abs(refined - (arm.inferredDuration || 0)) >= 2) {
				arm.inferredDuration = refined
				this.lastInferredDuration = refined
			}
			if (!arm.endTriggered && position >= this.getClipEndPositionThreshold()) {
				const action = this.getClipEndAction()
				if (action === 'align_zero') {
					this.triggerClipEndAlignZero().catch((err) => {
						this.log('error', `Clip end align failed: ${err.message}`)
					})
				} else if (action === 'stop' || action === 'none') {
					this.triggerClipEndStop().catch((err) => {
						this.log('error', `Clip end stop failed: ${err.message}`)
					})
				} else if (action === 'keep_running') {
					this.triggerClipEndRelease().catch((err) => {
						this.log('error', `Clip end release failed: ${err.message}`)
					})
				}
			}
			return
		}

		if (this.alignInFlight) return

		if (arm.phase === 'idle' && position > 0.002) {
			arm.phase = 'sampling'
			arm.samples = []
			arm.sampleStartMs = nowMs
		}

		if (arm.phase !== 'sampling') return

		arm.samples.push({ timeMs: nowMs, position })
		const windowMs = this.getSampleDelayMs()
		const elapsed = nowMs - arm.sampleStartMs
		const resolved = this.resolveClipDuration(arm)
		if (!resolved) {
			if (elapsed > 2500 && !arm.alignTimeoutLogged) {
				arm.alignTimeoutLogged = true
				this.log(
					'warn',
					`No align yet — check Resolume OSC out → this PC port ${this.getOscListenPort()}, layer ${arm.layer} clip ${arm.clip}`
				)
			}
			return
		}
		if (resolved.source === 'osc-slope' && elapsed < windowMs) return
		if (resolved.source === 'schedule' && elapsed < 40) return
		if (resolved.source === 'schedule' && !arm.usedScheduleFallback) {
			arm.usedScheduleFallback = true
			this.log('info', `Sync using cue duration ${resolved.duration}s (waiting for OSC slope to refine)`)
		}

		const remaining = remainingFromPositionPrecise(resolved.duration, position, false)
		this.triggerResolumeAlign(resolved.duration, remaining, nowMs, false, 'initial').catch((err) => {
			this.log('error', `Resolume align failed: ${err.message}`)
			arm.phase = 'idle'
			this.alignInFlight = false
		})
	}

	scheduleFollowUpAlign() {
		const arm = this.resolumeArm
		const delayMs = this.getFollowUpAlignMs()
		if (!arm || delayMs <= 0 || arm.followUpScheduled) return
		arm.followUpScheduled = true
		const self = this
		setTimeout(() => {
			const a = self.resolumeArm
			if (!a || a.phase !== 'aligned' || !a.inferredDuration) return
			const rem = remainingFromPositionPrecise(a.inferredDuration, a.lastPosition, false)
			self.triggerResolumeAlign(a.inferredDuration, rem, a.lastPositionMs, true, 'follow-up').catch((err) => {
				self.log('warn', `Follow-up align failed: ${err.message}`)
			})
		}, delayMs)
		const extraMs = parseInt(this.config?.followUpAlignMs2, 10)
		if (Number.isFinite(extraMs) && extraMs > delayMs) {
			setTimeout(() => {
				const a = self.resolumeArm
				if (!a || a.phase !== 'aligned' || !a.inferredDuration) return
				const rem = remainingFromPositionPrecise(a.inferredDuration, a.lastPosition, false)
				self.triggerResolumeAlign(a.inferredDuration, rem, a.lastPositionMs, true, 'follow-up-2').catch(() => {})
			}, extraMs)
		}
	}

	async stopSubCueResolumeAtClipEnd(eventId, itemId) {
		await this.apiPut('/api/sub-cue-timers/stop', {
			event_id: eventId,
			item_id: parseInt(itemId, 10),
		})
	}

	async triggerClipEndAlignZero() {
		const arm = this.resolumeArm
		const eventId = this.config?.eventId
		if (!arm || arm.endTriggered || !eventId || !arm.inferredDuration) return
		arm.endTriggered = true
		const dur = arm.inferredDuration
		const itemId = parseInt(arm.itemId, 10)
		try {
			if (arm.isSubCue) {
				await this.triggerResolumeAlign(dur, 0, arm.lastPositionMs || Date.now(), true, 'clip-end')
				await this.stopSubCueResolumeAtClipEnd(eventId, itemId)
				await this.apiPost('/api/timers/resolume-end', { event_id: eventId })
				this.stopPeriodicAlign()
				this.resolumeArm = null
				this.updateVariableValues()
				this.checkFeedbacks('resolume_armed', 'resolume_aligned')
				this.log('info', `Clip ended — sub-cue ${itemId} stopped at 0`)
				return
			}
			await this.triggerResolumeAlign(dur, 0, arm.lastPositionMs || Date.now(), true, 'clip-end')
			await this.apiPost('/api/timers/resolume-end', { event_id: eventId })
			this.stopPeriodicAlign()
			this.resolumeArm = null
			this.updateVariableValues()
			this.checkFeedbacks('resolume_armed', 'resolume_aligned')
			await this.fetchActiveTimer(eventId)
			this.log('info', `Clip ended — timer synced to 0 (overtime allowed)`)
		} catch (err) {
			arm.endTriggered = false
			throw err
		}
	}

	async triggerClipEndStop() {
		const arm = this.resolumeArm
		const eventId = this.config?.eventId
		if (!arm || arm.endTriggered || !eventId) return
		arm.endTriggered = true
		const itemId = parseInt(arm.itemId, 10)
		try {
			if (arm.isSubCue) {
				await this.stopSubCueResolumeAtClipEnd(eventId, itemId)
			} else {
				await this.apiPost('/api/timers/stop', { event_id: eventId, item_id: itemId })
			}
			await this.apiPost('/api/timers/resolume-end', { event_id: eventId })
			this.clearResolumeArm()
			await this.fetchActiveTimer(eventId)
			this.log(
				'info',
				arm.isSubCue
					? `Clip ended — sub-cue ${itemId} stopped`
					: `Clip ended — timer stopped for item ${itemId}`
			)
		} catch (err) {
			arm.endTriggered = false
			throw err
		}
	}

	/** Release Resolume lock only; main cue may keep running (overtime). Sub-cues always stop. */
	async triggerClipEndRelease() {
		const arm = this.resolumeArm
		const eventId = this.config?.eventId
		if (!arm || arm.endTriggered || !eventId) return
		arm.endTriggered = true
		const itemId = parseInt(arm.itemId, 10)
		try {
			if (arm.isSubCue) {
				await this.stopSubCueResolumeAtClipEnd(eventId, itemId)
			}
			await this.apiPost('/api/timers/resolume-end', { event_id: eventId })
			this.stopPeriodicAlign()
			this.resolumeArm = null
			this.updateVariableValues()
			this.checkFeedbacks('resolume_armed', 'resolume_aligned')
			await this.fetchActiveTimer(eventId)
			this.log(
				'info',
				arm.isSubCue
					? `Clip ended — sub-cue ${itemId} stopped`
					: 'Clip ended — released Resolume lock (timer still running)'
			)
		} catch (err) {
			arm.endTriggered = false
			throw err
		}
	}

	async triggerResolumeAlign(durationSeconds, remainingSeconds, alignAtMs, isFollowUp = false, reason = 'align') {
		if (this.alignInFlight || !this.resolumeArm) return
		this.alignInFlight = true
		const eventId = this.config?.eventId
		const itemId = this.resolumeArm.itemId
		const item = this.scheduleItems.find((s) => String(s.id) === String(itemId))
		const cueIs = item?.customFields?.cue ?? `CUE ${itemId}`
		const isSubCue =
			this.resolumeArm?.isSubCue === true ||
			this.isScheduleItemSubCue(item)

		if (isSubCue) {
			this.log('info', `Resolume align → sub-cue timer (item ${itemId})`)
		}

		try {
			await this.postResolumeAlign({
				eventId,
				itemId,
				cueIs,
				durationSeconds,
				remainingSeconds,
				alignAtMs: alignAtMs || Date.now(),
				alignReason: reason,
				isSubCue,
				rowNumber: item?.rowNumber ?? item?.row_number ?? 0,
			})
			this.recordSyncSuccess(reason, remainingSeconds, durationSeconds)
			const drift = this.getEstimatedDriftSeconds()
			this.log(
				'info',
				`[${reason}] SYNC #${this.syncCount} @ ${new Date().toLocaleTimeString()} — ${remainingSeconds}s left (dur ${durationSeconds}s)${drift != null ? `, drift ${drift}s` : ''}`
			)
			if (!isFollowUp) {
				this.scheduleFollowUpAlign()
				this.startPeriodicAlign()
			}
		} finally {
			this.alignInFlight = false
		}
	}

	async postResolumeAlign({
		eventId,
		itemId,
		cueIs,
		durationSeconds,
		remainingSeconds,
		alignAtMs,
		alignReason,
		isSubCue = false,
		rowNumber = 0,
	}) {
		if (!eventId || !itemId) throw new Error('event_id and item_id required')
		const alignAt = new Date(alignAtMs || Date.now()).toISOString()
		await this.apiPost('/api/timers/resolume-sync-align', {
			event_id: eventId,
			item_id: parseInt(itemId, 10),
			user_id: 'companion-resolume',
			cue_is: cueIs,
			duration_seconds: durationSeconds,
			remaining_seconds: remainingSeconds,
			align_at: alignAt,
			latency_compensation_ms: this.getNetworkDelayMs(),
			align_reason: alignReason || 'align',
			is_sub_cue: !!isSubCue,
			row_number: rowNumber,
		})
		await this.fetchActiveTimer(eventId)
		this.updateVariableValues()
	}

	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'apiUrl',
				label: 'API Base URL',
				width: 12,
				default: 'https://ros-50-production.up.railway.app',
				tooltip: 'Run of Show Railway API URL (must include new resolume-* routes)',
			},
			{
				type: 'number',
				id: 'apiFetchTimeoutMs',
				label: 'API fetch timeout (ms)',
				width: 6,
				default: 8000,
				min: 2000,
				max: 30000,
				tooltip: 'Prevents Companion stuck on Connecting if Railway is slow',
			},
			{
				type: 'textinput',
				id: 'eventId',
				label: 'Event ID',
				width: 12,
				tooltip: 'Paste the event ID from the Run of Show web app',
			},
			{
				type: 'number',
				id: 'day',
				label: 'Day',
				width: 4,
				default: 1,
				min: 1,
				max: 10,
			},
			{
				type: 'number',
				id: 'oscListenPort',
				label: 'OSC listen port (UDP)',
				width: 6,
				default: 7002,
				min: 1024,
				max: 65535,
				tooltip: 'Resolume must send OSC to this Companion PC IP on this port',
			},
			{
				type: 'number',
				id: 'sampleDelayMs',
				label: 'Duration sample window (ms)',
				width: 6,
				default: 120,
				min: 30,
				max: 2000,
				tooltip: 'Wait after play before first align. With cue duration, sync can happen sooner; slope needs ~2 OSC samples.',
			},
			{
				type: 'number',
				id: 'followUpAlignMs',
				label: 'Follow-up align #1 (ms)',
				width: 6,
				default: 400,
				min: 0,
				max: 5000,
				tooltip: '0 = off. Re-align shortly after first lock',
			},
			{
				type: 'number',
				id: 'followUpAlignMs2',
				label: 'Follow-up align #2 (ms)',
				width: 6,
				default: 1200,
				min: 0,
				max: 10000,
				tooltip: '0 = off. Second early correction (e.g. 1200ms)',
			},
			{
				type: 'number',
				id: 'periodicAlignIntervalSeconds',
				label: 'Periodic re-sync interval (seconds)',
				width: 6,
				default: 10,
				min: 0,
				max: 120,
				tooltip: '0 = off. Re-sync and Run of Show yellow flash every N seconds while clip is playing',
			},
			{
				type: 'dropdown',
				id: 'clipEndAction',
				label: 'When clip reaches end',
				width: 12,
				default: 'align_zero',
				choices: [
					{ id: 'align_zero', label: 'Sync to 0:00 and keep running (overtime OK)' },
					{ id: 'stop', label: 'Stop timer at clip end' },
					{ id: 'none', label: 'Do nothing — stop timer (no overtime)' },
					{ id: 'keep_running', label: 'Release Resolume lock only (timer keeps running)' },
				],
			},
			{
				type: 'number',
				id: 'clipEndPositionThreshold',
				label: 'Clip end position (0-1)',
				width: 6,
				default: 0.995,
				min: 0.9,
				max: 1,
				tooltip: 'When OSC position reaches this, run clip-end action',
			},
			{
				type: 'number',
				id: 'networkDelayMs',
				label: 'Network delay compensation (ms)',
				width: 6,
				default: 800,
				min: 0,
				max: 15000,
				tooltip:
					'Subtract from started_at on each sync. If ROS shows MORE time than Resolume, lower this. If LESS, raise it (try 500–1500 first, not 3000).',
			},
			{
				type: 'textinput',
				id: 'resolumeSendHost',
				label: 'Resolume target host (for trigger on arm)',
				width: 8,
				default: '127.0.0.1',
				tooltip: 'IP/hostname of Resolume machine to send OSC trigger (clip/column connect)',
			},
			{
				type: 'number',
				id: 'resolumeSendPort',
				label: 'Resolume target port (for trigger on arm)',
				width: 4,
				default: 7000,
				min: 1,
				max: 65535,
				tooltip: 'OSC input port in Resolume',
			},
		]
	}

	updateActions() {
		UpdateActions(this)
	}

	async updateFeedbacks() {
		await UpdateFeedbacks(this)
	}

	checkAllFeedbacks() {
		this.checkFeedbacks('resolume_armed', 'resolume_aligned', 'resolume_sync_pulse')
	}

	updatePresets() {
		const presets = {
			arm_resolume_generic: {
				type: 'button',
				category: 'Resolume',
				name: 'Arm Resolume sync (select cue)',
				style: {
					text: 'Arm+Load\n(Select Cue)',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(90, 40, 120),
				},
				feedbacks: [
					{
						feedbackId: 'resolume_armed',
						options: {},
						style: { bgcolor: combineRgb(160, 80, 200), color: combineRgb(255, 255, 255) },
					},
					{
						feedbackId: 'resolume_aligned',
						options: {},
						style: { bgcolor: combineRgb(0, 140, 60), color: combineRgb(255, 255, 255) },
					},
					{
						feedbackId: 'resolume_sync_pulse',
						options: {},
						style: { bgcolor: combineRgb(0, 180, 220), color: combineRgb(0, 0, 0) },
					},
				],
				steps: [{ down: [{ actionId: 'arm_resolume_sync', options: { itemId: '', layer: 1, clip: 1, triggerOnArm: true, triggerType: 'clip', column: 1 } }], up: [] }],
			},
			disarm_resolume: {
				type: 'button',
				category: 'Resolume',
				name: 'Disarm Resolume sync',
				style: {
					text: 'Disarm',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(80, 80, 80),
				},
				feedbacks: [],
				steps: [{ down: [{ actionId: 'disarm_resolume_sync', options: {} }], up: [] }],
			},
			set_cue_duration_from_clip: {
				type: 'button',
				category: 'Resolume Duration',
				name: 'Set cue duration from clip (pick cue + layer/clip)',
				style: {
					text: 'Set dur\nfrom clip',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(60, 80, 140),
				},
				feedbacks: [],
				steps: [
					{
						down: [
							{
								actionId: 'resolume_set_cue_duration',
								options: {
									itemId: '',
									layer: 1,
									clip: 1,
									durationSeconds: 0,
									sampleMs: 600,
									triggerClip: true,
								},
							},
						],
						up: [],
					},
				],
			},
			end_resolume: {
				type: 'button',
				category: 'Resolume',
				name: 'End Resolume sync',
				style: {
					text: 'End\nResolume',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(120, 60, 0),
				},
				feedbacks: [],
				steps: [{ down: [{ actionId: 'end_resolume_sync', options: {} }], up: [] }],
			},
		}

		presets.arm_sub_resolume_generic = {
			type: 'button',
			category: 'Resolume Sub-Cues',
			name: 'Arm sub-cue sync (select sub-cue + layer/clip)',
			style: {
				text: 'Arm sub\n(Select)',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(70, 45, 110),
			},
			feedbacks: [
				{
					feedbackId: 'resolume_armed',
					options: {},
					style: { bgcolor: combineRgb(160, 80, 200), color: combineRgb(255, 255, 255) },
				},
				{
					feedbackId: 'resolume_aligned',
					options: {},
					style: { bgcolor: combineRgb(0, 140, 60), color: combineRgb(255, 255, 255) },
				},
				{
					feedbackId: 'resolume_sync_pulse',
					options: {},
					style: { bgcolor: combineRgb(0, 180, 220), color: combineRgb(0, 0, 0) },
				},
			],
			steps: [
				{
					down: [
						{
							actionId: 'arm_resolume_sub_sync',
							options: { itemId: '', layer: 1, clip: 1, triggerOnArm: true, triggerType: 'clip', column: 1 },
						},
					],
					up: [],
				},
			],
		}

		presets.set_sub_cue_duration_from_clip = {
			type: 'button',
			category: 'Resolume Sub-Cue Duration',
			name: 'Set sub-cue duration from clip (pick sub-cue + layer/clip)',
			style: {
				text: 'Sub dur\nfrom clip',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(45, 60, 120),
			},
			feedbacks: [],
			steps: [
				{
					down: [
						{
							actionId: 'resolume_set_subcue_duration',
							options: {
								itemId: '',
								layer: 1,
								clip: 1,
								durationSeconds: 0,
								sampleMs: 600,
								triggerClip: true,
							},
						},
					],
					up: [],
				},
			],
		}

		for (const item of this.getRegularCues()) {
			const cueDisplay = this.formatCueDisplay(item.customFields?.cue, item.id)
			presets[`set_duration_cue_${item.id}`] = {
				type: 'button',
				category: 'Resolume Duration',
				name: `Set duration — ${cueDisplay}`,
				style: {
					text: `${cueDisplay}\nSet dur`,
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(50, 70, 130),
				},
				feedbacks: [],
				steps: [
					{
						down: [
							{
								actionId: 'resolume_set_cue_duration',
								options: {
									itemId: String(item.id),
									layer: 1,
									clip: 1,
									durationSeconds: 0,
									sampleMs: 600,
									triggerClip: true,
								},
							},
						],
						up: [],
					},
				],
			}
		}

		for (const item of this.getSubCues()) {
			const cueDisplay = this.formatCueDisplay(item.customFields?.cue, item.id)
			presets[`set_duration_sub_${item.id}`] = {
				type: 'button',
				category: 'Resolume Sub-Cue Duration',
				name: `Set duration — ${cueDisplay}`,
				style: {
					text: `${cueDisplay}\nSet dur`,
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(40, 55, 105),
				},
				feedbacks: [],
				steps: [
					{
						down: [
							{
								actionId: 'resolume_set_subcue_duration',
								options: {
									itemId: String(item.id),
									layer: 1,
									clip: 1,
									durationSeconds: 0,
									sampleMs: 600,
									triggerClip: true,
								},
							},
						],
						up: [],
					},
				],
			}
			presets[`arm_sub_cue_${item.id}`] = {
				type: 'button',
				category: 'Resolume Sub-Cues',
				name: `Arm + Load sub — ${cueDisplay}`,
				style: {
					text: `${cueDisplay}\nArm sub`,
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(65, 40, 105),
				},
				feedbacks: [
					{
						feedbackId: 'resolume_armed',
						options: {},
						style: { bgcolor: combineRgb(160, 80, 200), color: combineRgb(255, 255, 255) },
					},
					{
						feedbackId: 'resolume_aligned',
						options: {},
						style: { bgcolor: combineRgb(0, 140, 60), color: combineRgb(255, 255, 255) },
					},
					{
						feedbackId: 'resolume_sync_pulse',
						options: {},
						style: { bgcolor: combineRgb(0, 180, 220), color: combineRgb(0, 0, 0) },
					},
				],
				steps: [
					{
						down: [
							{
								actionId: 'arm_resolume_sub_sync',
								options: {
									itemId: String(item.id),
									layer: 1,
									clip: 1,
									triggerOnArm: true,
									triggerType: 'clip',
									column: 1,
								},
							},
						],
						up: [],
					},
				],
			}
		}

		for (const item of this.getRegularCues()) {
			const cueDisplay = this.formatCueDisplay(item.customFields?.cue, item.id)
			presets[`arm_cue_${item.id}`] = {
				type: 'button',
				category: 'Resolume Cues',
				name: `Arm + Load ${cueDisplay}`,
				style: {
					text: `${cueDisplay}\nArm+Load`,
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(75, 40, 120),
				},
				feedbacks: [
					{
						feedbackId: 'resolume_armed',
						options: {},
						style: { bgcolor: combineRgb(160, 80, 200), color: combineRgb(255, 255, 255) },
					},
					{
						feedbackId: 'resolume_aligned',
						options: {},
						style: { bgcolor: combineRgb(0, 140, 60), color: combineRgb(255, 255, 255) },
					},
					{
						feedbackId: 'resolume_sync_pulse',
						options: {},
						style: { bgcolor: combineRgb(0, 180, 220), color: combineRgb(0, 0, 0) },
					},
				],
				steps: [{ down: [{ actionId: 'arm_resolume_sync', options: { itemId: String(item.id), layer: 1, clip: 1, triggerOnArm: true, triggerType: 'clip', column: 1 } }], up: [] }],
			}
		}

		this.setPresetDefinitions(presets)
	}

	updateVariableDefinitions() {
		UpdateVariableDefinitions(this)
	}

	updateVariableValues() {
		const eventId = this.config?.eventId
		const event = eventId ? this.events.find((e) => String(e.id) === String(eventId)) : null
		const currentItem = this.scheduleItems.find((s) => String(s.id) === String(this.activeTimer?.item_id))
		const cueLabel = currentItem
			? this.formatCueDisplay(currentItem.customFields?.cue ?? this.activeTimer?.cue_is, currentItem.id)
			: (this.activeTimer?.cue_is ?? '—')

		const phase = this.resolumeArm?.phase ?? 'off'
		const statusMap = {
			off: 'Off',
			idle: 'Armed — waiting for playback',
			sampling: 'Receiving OSC — locking…',
			aligned: 'Locked to Resolume',
		}
		const drift = this.getEstimatedDriftSeconds()

		this.setVariableValues({
			resolume_armed: this.resolumeArm ? 'Yes' : 'No',
			resolume_sync_status: this.resolumeArm ? statusMap[phase] || phase : 'Off',
			resolume_layer: this.resolumeArm ? String(this.resolumeArm.layer) : '—',
			resolume_clip: this.resolumeArm ? String(this.resolumeArm.clip) : '—',
			resolume_inferred_duration: this.lastInferredDuration != null ? String(this.lastInferredDuration) : '—',
			last_sync_at: this.lastSyncAt ? new Date(this.lastSyncAt).toLocaleTimeString() : '—',
			last_sync_reason: this.lastSyncReason || '—',
			sync_count: String(this.syncCount || 0),
			last_sync_remaining: this.lastSyncRemaining != null ? String(this.lastSyncRemaining) : '—',
			estimated_drift: drift != null ? `${drift}s` : '—',
			current_cue: cueLabel,
			timer_running: this.activeTimer?.is_running === true ? 'Yes' : 'No',
			event_name: event?.name ?? '—',
		})
	}
}

runEntrypoint(RunOfShowResolumeInstance, UpgradeScripts)
