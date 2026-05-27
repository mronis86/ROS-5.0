const { InstanceBase, runEntrypoint, InstanceStatus, combineRgb } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')
const {
	positionAddress,
	connectAddress,
	matchesAddress,
	inferDurationFromSamples,
	remainingFromPosition,
	createUdpPort,
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
	}

	async init(config) {
		this.config = config
		this.updateStatus(InstanceStatus.Connecting)
		await this.fetchData()
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.updateVariableValues()
		this.checkAllFeedbacks()
		this.ensureOscListener()
		this.updateStatus(InstanceStatus.Ok)
	}

	async destroy() {
		this.closeOscListener()
		this.resolumeArm = null
	}

	async configUpdated(config) {
		this.config = config
		this.updateStatus(InstanceStatus.Connecting)
		await this.fetchData()
		this.closeOscListener()
		this.ensureOscListener()
		this.updateActions()
		this.updateFeedbacks()
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
		return Number.isFinite(ms) && ms >= 50 ? ms : 120
	}

	async fetch(url, options = {}) {
		const baseUrl = this.getApiUrl()
		const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`
		const res = await fetch(fullUrl, {
			...options,
			headers: { 'Content-Type': 'application/json', ...options.headers },
		})
		if (!res.ok) throw new Error(`HTTP ${res.status}`)
		const text = await res.text()
		return text ? JSON.parse(text) : null
	}

	async apiPost(path, body) {
		const baseUrl = this.getApiUrl()
		const res = await fetch(`${baseUrl}${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
		if (!res.ok) {
			const err = await res.text()
			throw new Error(err || `HTTP ${res.status}`)
		}
		return res.json().catch(() => ({}))
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
			return
		}
		try {
			await this.fetchEvents()
			await this.fetchRunOfShow(eventId, this.config?.day || 1)
			await this.fetchActiveTimer(eventId)
		} catch (err) {
			this.log('error', `Failed to fetch data: ${err.message}`)
		}
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

	setResolumeArm({ itemId, layer, clip }) {
		this.resolumeArm = {
			itemId: String(itemId),
			layer,
			clip,
			phase: 'idle',
			samples: [],
			sampleStartMs: 0,
			inferredDuration: null,
			positionAddress: positionAddress(layer, clip),
			connectAddress: connectAddress(layer, clip),
		}
		this.alignInFlight = false
	}

	clearResolumeArm() {
		this.resolumeArm = null
		this.alignInFlight = false
		this.updateVariableValues()
		this.checkFeedbacks('resolume_armed')
	}

	closeOscListener() {
		if (this.oscPort) {
			try {
				this.oscPort.close()
			} catch (_) {}
			this.oscPort = null
		}
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
		if (!this.resolumeArm || this.alignInFlight) return
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
			return
		}

		if (!matchesAddress(address, arm.positionAddress)) return
		const position = Number(value)
		if (!Number.isFinite(position)) return

		if (arm.phase === 'idle' && position > 0.002) {
			arm.phase = 'sampling'
			arm.samples = []
			arm.sampleStartMs = Date.now()
		}

		if (arm.phase !== 'sampling') return

		const nowMs = Date.now()
		arm.samples.push({ timeMs: nowMs, position })
		if (nowMs - arm.sampleStartMs < this.getSampleDelayMs()) return

		const duration = inferDurationFromSamples(arm.samples)
		if (!duration) return

		const remaining = remainingFromPosition(duration, position)
		this.triggerResolumeAlign(duration, remaining).catch((err) => {
			this.log('error', `Resolume align failed: ${err.message}`)
			arm.phase = 'idle'
			this.alignInFlight = false
		})
	}

	async triggerResolumeAlign(durationSeconds, remainingSeconds) {
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
			})
			this.lastInferredDuration = durationSeconds
			this.resolumeArm.phase = 'aligned'
			this.resolumeArm.inferredDuration = durationSeconds
			this.updateVariableValues()
			this.log(
				'info',
				`Resolume aligned: ${remainingSeconds}s remaining (inferred duration ${durationSeconds}s)`
			)
		} finally {
			this.alignInFlight = false
		}
	}

	async postResolumeAlign({ eventId, itemId, cueIs, durationSeconds, remainingSeconds }) {
		if (!eventId || !itemId) throw new Error('event_id and item_id required')
		await this.apiPost('/api/timers/resolume-sync-align', {
			event_id: eventId,
			item_id: parseInt(itemId, 10),
			user_id: 'companion-resolume',
			cue_is: cueIs,
			duration_seconds: durationSeconds,
			remaining_seconds: remainingSeconds,
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
				tooltip: 'Run of Show Railway API URL',
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
				min: 50,
				max: 2000,
				tooltip: 'Wait this long after clip play before inferring duration from position slope',
			},
		]
	}

	updateActions() {
		UpdateActions(this)
	}

	updateFeedbacks() {
		UpdateFeedbacks(this)
	}

	checkAllFeedbacks() {
		this.checkFeedbacks('resolume_armed')
	}

	updatePresets() {
		this.setPresetDefinitions({
			arm_resolume: {
				type: 'button',
				category: 'Resolume',
				name: 'Arm Resolume sync',
				style: {
					text: 'Arm\nResolume',
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
				],
				steps: [{ down: [{ actionId: 'arm_resolume_sync', options: { itemId: '', layer: 1, clip: 1 } }], up: [] }],
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
		})
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
