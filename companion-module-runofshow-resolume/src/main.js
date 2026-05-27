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
		this.activeTimer = null
		this.resolumeArm = null
		this.oscPort = null
		this.lastInferredDuration = null
		this.alignInFlight = false
		this.periodicAlignInterval = null
	}

	async init(config) {
		await this.applyConfig(config, true)
	}

	async destroy() {
		this.stopPeriodicAlign()
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

	/** align_zero = snap to 0 and keep running (overtime). stop = legacy hard stop. none = ignore clip end. */
	getClipEndAction() {
		const a = String(this.config?.clipEndAction || '').trim()
		if (a === 'stop' || a === 'none') return a
		// Legacy checkbox
		if (this.config?.autoStopAtClipEnd === true || this.config?.autoStopAtClipEnd === 'true') return 'stop'
		return 'align_zero'
	}

	getNetworkDelayMs() {
		const ms = parseInt(this.config?.networkDelayMs, 10)
		return Number.isFinite(ms) && ms >= 0 ? Math.min(5000, ms) : 800
	}

	getClipEndPositionThreshold() {
		const t = Number(this.config?.clipEndPositionThreshold)
		return Number.isFinite(t) && t > 0.9 && t <= 1 ? t : 0.995
	}

	getPeriodicAlignIntervalSeconds() {
		const s = parseInt(this.config?.periodicAlignIntervalSeconds, 10)
		return Number.isFinite(s) && s >= 0 ? s : 10
	}

	getPeriodicAlignDriftThreshold() {
		const s = Number(this.config?.periodicAlignDriftThreshold)
		return Number.isFinite(s) && s >= 0 ? s : 1
	}

	getRosRemainingSeconds() {
		const t = this.activeTimer
		if (!t?.is_running || !t.started_at || t.duration_seconds == null) return null
		const startedMs = new Date(t.started_at).getTime()
		if (!Number.isFinite(startedMs) || startedMs > Date.now() + 86400000) return null
		return Math.max(0, t.duration_seconds - (Date.now() - startedMs) / 1000)
	}

	shouldPeriodicRealign(arm) {
		const threshold = this.getPeriodicAlignDriftThreshold()
		if (threshold <= 0) return true
		const resolumeRem = remainingFromPositionPrecise(arm.inferredDuration, arm.lastPosition, false)
		const rosRem = this.getRosRemainingSeconds()
		if (rosRem == null) return true
		return Math.abs(rosRem - resolumeRem) >= threshold
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
			const arm = self.resolumeArm
			if (!arm || arm.phase !== 'aligned' || !arm.inferredDuration || arm.endTriggered) return
			if (!self.shouldPeriodicRealign(arm)) return
			const rem = remainingFromPositionPrecise(arm.inferredDuration, arm.lastPosition, false)
			self.triggerResolumeAlign(arm.inferredDuration, rem, arm.lastPositionMs, true, 'periodic').catch((err) => {
				self.log('warn', `Periodic align failed: ${err.message}`)
			})
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

	async fetchEvents() {
		const data = await this.fetch('/api/calendar-events')
		this.events = Array.isArray(data) ? data : []
		return this.events
	}

	async fetchRunOfShow(eventId, day = 1) {
		const data = await this.fetch(`/api/run-of-show-data/${eventId}`)
		if (!data || !data.schedule_items) {
			this.scheduleItems = []
			return []
		}
		let items = typeof data.schedule_items === 'string' ? JSON.parse(data.schedule_items) : data.schedule_items
		if (!Array.isArray(items)) items = []
		const dayNum = parseInt(day, 10) || 1
		this.scheduleItems = items.filter((item) => (item.day || 1) === dayNum)
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

	async fetchData() {
		const eventId = this.config?.eventId
		if (!eventId) {
			this.events = []
			this.scheduleItems = []
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

	async loadCueForResolume(eventId, itemId) {
		await this.fetchActiveTimer(eventId)
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

	async notifyResolumeArm(itemId) {
		const eventId = this.config?.eventId
		if (!eventId || !itemId) return
		try {
			await this.apiPost('/api/timers/resolume-arm', {
				event_id: eventId,
				item_id: parseInt(itemId, 10),
			})
		} catch (err) {
			this.log('warn', `resolume-arm notify failed: ${err.message}`)
		}
	}

	setResolumeArm({ itemId, layer, clip }) {
		this.resolumeArm = {
			itemId: String(itemId),
			layer,
			clip,
			phase: 'idle',
			samples: [],
			sampleStartMs: 0,
			inferredDuration: null,
			lastPosition: 0,
			lastPositionMs: 0,
			endTriggered: false,
			followUpScheduled: false,
			positionAddress: positionAddress(layer, clip),
			connectAddress: connectAddress(layer, clip),
		}
		this.alignInFlight = false
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
		if (!this.resolumeArm) return
		const address = oscMsg?.address
		const args = oscMsg?.args || []
		const value = args[0]?.value
		const arm = this.resolumeArm

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
			if (!arm.endTriggered && position >= this.getClipEndPositionThreshold()) {
				const action = this.getClipEndAction()
				if (action === 'align_zero') {
					this.triggerClipEndAlignZero().catch((err) => {
						this.log('error', `Clip end align failed: ${err.message}`)
					})
				} else if (action === 'stop') {
					this.triggerClipEndStop().catch((err) => {
						this.log('error', `Clip end stop failed: ${err.message}`)
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
		if (nowMs - arm.sampleStartMs < this.getSampleDelayMs()) return

		const duration = inferDurationFromSamples(arm.samples)
		if (!duration) return

		const remaining = remainingFromPositionPrecise(duration, position, false)
		this.triggerResolumeAlign(duration, remaining, nowMs, false, 'initial').catch((err) => {
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

	async triggerClipEndAlignZero() {
		const arm = this.resolumeArm
		const eventId = this.config?.eventId
		if (!arm || arm.endTriggered || !eventId || !arm.inferredDuration) return
		arm.endTriggered = true
		const dur = arm.inferredDuration
		try {
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
			await this.apiPost('/api/timers/stop', { event_id: eventId, item_id: itemId })
			await this.apiPost('/api/timers/resolume-end', { event_id: eventId })
			this.clearResolumeArm()
			await this.fetchActiveTimer(eventId)
			this.log('info', `Clip ended — timer stopped for item ${itemId}`)
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

		try {
			await this.postResolumeAlign({
				eventId,
				itemId,
				cueIs,
				durationSeconds,
				remainingSeconds,
				alignAtMs: alignAtMs || Date.now(),
			})
			this.lastInferredDuration = durationSeconds
			this.resolumeArm.phase = 'aligned'
			this.resolumeArm.inferredDuration = durationSeconds
			this.updateVariableValues()
			this.checkFeedbacks('resolume_armed', 'resolume_aligned')
			this.log(
				'info',
				`[${reason}] aligned: ${remainingSeconds}s remaining (duration ${durationSeconds}s)`
			)
			if (!isFollowUp) {
				this.scheduleFollowUpAlign()
				this.startPeriodicAlign()
			}
		} finally {
			this.alignInFlight = false
		}
	}

	async postResolumeAlign({ eventId, itemId, cueIs, durationSeconds, remainingSeconds, alignAtMs }) {
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
				default: 80,
				min: 30,
				max: 2000,
				tooltip: 'Wait this long after clip play before first align (lower = faster, may be less accurate)',
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
				tooltip: '0 = off. Re-check Resolume vs clock every N seconds while armed',
			},
			{
				type: 'number',
				id: 'periodicAlignDriftThreshold',
				label: 'Re-sync only if drift >= (seconds)',
				width: 6,
				default: 1,
				min: 0,
				max: 30,
				tooltip: '0 = always re-sync on interval. 1 = only fix when off by 1+ second',
			},
			{
				type: 'dropdown',
				id: 'clipEndAction',
				label: 'When clip reaches end',
				width: 12,
				default: 'align_zero',
				choices: [
					{ id: 'align_zero', label: 'Sync to 0:00 and keep running (overtime OK)' },
					{ id: 'stop', label: 'Stop timer' },
					{ id: 'none', label: 'Do nothing' },
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
				max: 5000,
				tooltip: 'Subtract from started_at so web clocks catch up after HTTP/WebSocket delay',
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
		this.checkFeedbacks('resolume_armed', 'resolume_aligned')
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

		// One ready-to-use Arm+Load preset per cue (no manual cue option editing needed)
		for (const item of this.scheduleItems || []) {
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

		this.setVariableValues({
			resolume_armed: this.resolumeArm ? 'Yes' : 'No',
			resolume_layer: this.resolumeArm ? String(this.resolumeArm.layer) : '—',
			resolume_clip: this.resolumeArm ? String(this.resolumeArm.clip) : '—',
			resolume_inferred_duration: this.lastInferredDuration != null ? String(this.lastInferredDuration) : '—',
			current_cue: cueLabel,
			timer_running: this.activeTimer?.is_running === true ? 'Yes' : 'No',
			event_name: event?.name ?? '—',
		})
	}
}

runEntrypoint(RunOfShowResolumeInstance, UpgradeScripts)
