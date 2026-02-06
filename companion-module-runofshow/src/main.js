const { InstanceBase, runEntrypoint, InstanceStatus, combineRgb } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')

class RunOfShowInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.events = []
		this.scheduleItems = []
		this.activeTimer = null
		this.pollInterval = null
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
		this.startPolling()
		this.updateStatus(InstanceStatus.Ok)
	}

	async destroy() {
		if (this.pollInterval) {
			clearInterval(this.pollInterval)
		}
	}

	async configUpdated(config) {
		this.config = config
		this.updateStatus(InstanceStatus.Connecting)
		await this.fetchData()
		this.startPolling() // restart with new sync interval and event ID
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.updateVariableValues()
		this.updateStatus(InstanceStatus.Ok)
	}

	getApiUrl() {
		const url = (this.config?.apiUrl || '').trim().replace(/\/+$/, '')
		return url || 'https://ros-50-production.up.railway.app'
	}

	async fetch(url, options = {}) {
		const baseUrl = this.getApiUrl()
		const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`
		try {
			const res = await fetch(fullUrl, {
				...options,
				headers: { 'Content-Type': 'application/json', ...options.headers },
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const text = await res.text()
			return text ? JSON.parse(text) : null
		} catch (err) {
			this.log('error', `API request failed: ${err.message}`)
			throw err
		}
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

	startPolling() {
		if (this.pollInterval) clearInterval(this.pollInterval)
		this.pollInterval = null
		const seconds = Math.max(5, Math.min(600, parseInt(this.config?.syncIntervalSeconds, 10) || 60))
		const ms = seconds * 1000
		this.pollInterval = setInterval(() => {
			if (this.config?.eventId) {
				this.fetchData().then(() => {
					this.updateActions()
					this.updateFeedbacks()
					this.updatePresets()
					this.updateVariableDefinitions()
					this.updateVariableValues()
				}).catch(() => {})
			}
		}, ms)
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

	async apiPut(path, body) {
		const baseUrl = this.getApiUrl()
		const res = await fetch(`${baseUrl}${path}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
		if (!res.ok) {
			const err = await res.text()
			throw new Error(err || `HTTP ${res.status}`)
		}
		return res.json().catch(() => ({}))
	}

	async apiDelete(path) {
		const baseUrl = this.getApiUrl()
		const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' })
		if (!res.ok) throw new Error(`HTTP ${res.status}`)
		return res.json().catch(() => ({}))
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
				tooltip: 'Paste the event ID from the Run of Show web app (Events list)',
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
				id: 'syncIntervalSeconds',
				label: 'Sync interval (seconds)',
				width: 6,
				default: 60,
				min: 5,
				max: 600,
				tooltip: 'How often to fetch schedule/timer from the API (5–600 seconds). Lower = more responsive, higher = less traffic.',
			},
		]
	}

	updateActions() {
		UpdateActions(this)
	}

	updateFeedbacks() {
		UpdateFeedbacks(this)
	}

	// Ensure cue displays as "CUE 1" / "CUE 1.1" not just "1" / "1.1"
	formatCueDisplay(raw, itemId) {
		const s = String(raw ?? itemId ?? '').trim()
		if (!s) return `CUE ${itemId}`
		if (/^\d+(\.\d+)?$/.test(s)) return `CUE ${s}`
		if (/^CUE\s+/i.test(s)) return s
		return `CUE ${s}`
	}

	updatePresets() {
		const presets = {}
		const items = this.scheduleItems || []
		for (const item of items) {
			const cueDisplay = this.formatCueDisplay(item.customFields?.cue, item.id)
			const fullLabel = `${cueDisplay}: ${item.segmentName || 'Untitled'}`
			const id = `cue_${item.id}`
			presets[id] = {
				type: 'button',
				category: 'Cues',
				name: fullLabel,
				style: {
					text: cueDisplay,
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(40, 40, 40),
				},
				feedbacks: [
					{
						feedbackId: 'loaded_cue_is',
						options: { itemId: String(item.id) },
						style: { bgcolor: combineRgb(50, 100, 200), color: combineRgb(255, 255, 255) },
					},
				],
				steps: [
					{
						down: [{ actionId: 'load_cue', options: { itemId: String(item.id) } }],
						up: [],
					},
				],
			}
		}
		this.setPresetDefinitions(presets)
	}

	updateVariableDefinitions() {
		UpdateVariableDefinitions(this)
	}

	updateVariableValues() {
		const eventId = this.config?.eventId
		if (!eventId) return

		const event = this.events.find((e) => String(e.id) === String(eventId))
		const currentItem = this.scheduleItems.find((s) => String(s.id) === String(this.activeTimer?.item_id))
		const cueLabel = currentItem ? this.formatCueDisplay(currentItem.customFields?.cue ?? this.activeTimer?.cue_is, currentItem.id) : (this.activeTimer?.cue_is ?? '—')
		const segmentName = currentItem?.segmentName ?? '—'
		const loadedCueValue = currentItem?.customFields?.value ?? segmentName ?? '—'
		const timerRunning = this.activeTimer?.is_running === true

		const values = {
			current_cue: cueLabel,
			current_segment: segmentName,
			loaded_cue_value: loadedCueValue,
			timer_running: timerRunning ? 'Yes' : 'No',
			event_name: event?.name ?? '—',
		}

		// Per-cue variables: label shows CUE 1 / CUE 1.1 not just 1
		for (const item of this.scheduleItems) {
			values[`cue_${item.id}_label`] = this.formatCueDisplay(item.customFields?.cue, item.id)
			values[`cue_${item.id}_value`] = item.customFields?.value ?? item.segmentName ?? '—'
		}

		this.setVariableValues(values)
	}
}

runEntrypoint(RunOfShowInstance, UpgradeScripts)
