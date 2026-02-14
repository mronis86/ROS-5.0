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
		this.autoDisableTimeout = null
		this.refreshStartedAt = null
		this.syncPausedByTimer = false
	}

	async init(config) {
		this.config = config
		this.refreshStartedAt = Date.now()
		this.updateStatus(InstanceStatus.Connecting)
		await this.fetchData()
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.updateVariableValues()
		this.checkAllFeedbacks()
		if (this.getSyncIntervalEnabled()) this.startPolling()
		this.updateStatus(InstanceStatus.Ok)
	}

	async destroy() {
		if (this.pollInterval) clearInterval(this.pollInterval)
		if (this.autoDisableTimeout) clearTimeout(this.autoDisableTimeout)
	}

	async configUpdated(config) {
		this.config = config
		this.refreshStartedAt = Date.now()
		this.updateStatus(InstanceStatus.Connecting)
		await this.fetchData()
		if (this.getSyncIntervalEnabled()) this.startPolling()
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

	getSyncIntervalEnabled() {
		const v = this.config?.syncIntervalEnabled
		return v !== false && v !== 'false'
	}

	// Hours after which to auto-disconnect sync. 0 = never. From single "Auto-disable sync after (hours)" field.
	getAutoDisableHours() {
		const h = parseInt(this.config?.autoDisableSyncAfterHours, 10)
		if (Number.isFinite(h) && h >= 0) return Math.min(168, h)
		return 0
	}

	startPolling() {
		if (this.pollInterval) clearInterval(this.pollInterval)
		if (this.autoDisableTimeout) clearTimeout(this.autoDisableTimeout)
		this.pollInterval = null
		this.autoDisableTimeout = null
		this.syncPausedByTimer = false
		if (!this.getSyncIntervalEnabled()) return
		this.refreshStartedAt = Date.now()
		const autoDisableHours = this.getAutoDisableHours()
		if (autoDisableHours > 0) {
			this.log('info', `Starting Auto Disable Sync: will turn off after ${autoDisableHours} hour(s)`)
			const self = this
			const limitMs = autoDisableHours * 60 * 60 * 1000
			this.autoDisableTimeout = setTimeout(function onAutoDisable() {
				self.autoDisableTimeout = null
				if (self.pollInterval) {
					clearInterval(self.pollInterval)
					self.pollInterval = null
				}
				self.syncPausedByTimer = true
				self.log('info', `Auto-disable sync: sync interval turned off after ${autoDisableHours} hour(s)`)
				self.updateStatus(InstanceStatus.Ok)
				self.updateVariableValues()
				try {
					self.saveConfig({ ...self.config, syncIntervalEnabled: false })
				} catch (e) {
					self.log('warn', 'Could not update config: ' + (e && e.message))
				}
			}, limitMs)
		}
		const seconds = Math.max(5, Math.min(600, parseInt(this.config?.syncIntervalSeconds, 10) || 60))
		const ms = seconds * 1000
		const self = this
		this.pollInterval = setInterval(function tick() {
			if (!self.config?.eventId) return
			self.fetchData().then(() => {
				self.updateActions()
				self.updateFeedbacks()
				self.updatePresets()
				self.updateVariableDefinitions()
				self.updateVariableValues()
				self.checkAllFeedbacks()
			}).catch(() => {})
		}, ms)
		this.updateVariableValues()
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
				type: 'checkbox',
				id: 'syncIntervalEnabled',
				label: 'Enable sync interval',
				width: 12,
				default: true,
				tooltip: 'When ON: fetch schedule/timer every "Sync interval (seconds)". When OFF: no periodic fetch (Load cue / Start timer still work). Turn back on or use "Resume sync" to sync again.',
			},
			{
				type: 'number',
				id: 'syncIntervalSeconds',
				label: 'Sync interval (seconds)',
				width: 6,
				default: 60,
				min: 5,
				max: 600,
				tooltip: 'How often to fetch from API (5–600). Used only when "Enable sync interval" is ON.',
			},
			{
				type: 'number',
				id: 'autoDisableSyncAfterHours',
				label: 'Auto-disable sync after (hours)',
				width: 6,
				default: 0,
				min: 0,
				max: 168,
				tooltip: '0 = never. 1+ = turn off sync after that many hours; use "Enable sync interval" to resume.',
			},
		]
	}

	updateActions() {
		UpdateActions(this)
	}

	updateFeedbacks() {
		UpdateFeedbacks(this)
	}

	// Ask Companion to re-evaluate all feedback values (button highlight state). Call after any data refresh
	// so buttons update without the user toggling. Does not trigger API poll by itself.
	checkAllFeedbacks() {
		this.checkFeedbacks('timer_running', 'cue_loaded', 'loaded_cue_is', 'button_text_from_cue')
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
		// Regular cues = not indented (main CUE rows). Sub-cues = indented (sub-rows under a CUE).
		const regularCues = items.filter((item) => !item.isIndented)
		const subCues = items.filter((item) => item.isIndented === true)

		// One preset per regular cue only (Load Cue + feedback)
		for (const item of regularCues) {
			const cueDisplay = this.formatCueDisplay(item.customFields?.cue, item.id)
			const fullLabel = `${cueDisplay}: ${item.segmentName || 'Untitled'}`
			presets[`cue_${item.id}`] = {
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

		// Resume sync (when sync was stopped by "Stop sync after X hours")
		presets.resume_sync = {
			type: 'button',
			category: 'Sync',
			name: 'Resume sync',
			style: {
				text: 'Resume sync',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(80, 80, 120),
			},
			feedbacks: [],
			steps: [
				{
					down: [{ actionId: 'resume_sync', options: {} }],
					up: [],
				},
			],
		}

		// Timer control presets (Start, Stop, Reset, +/- 1 min, +/- 5 min)
		const timerPresets = {
			start_timer: { name: 'Start Timer', actionId: 'start_timer', text: 'Start', bgcolor: combineRgb(0, 120, 0) },
			stop_timer: { name: 'Stop Timer', actionId: 'stop_timer', text: 'Stop', bgcolor: combineRgb(120, 0, 0) },
			reset_timer: { name: 'Reset Timer', actionId: 'reset_timer', text: 'Reset', bgcolor: combineRgb(80, 80, 0) },
			timer_plus_1: { name: 'Timer +1 min', actionId: 'adjust_timer_plus_1', text: '+1', bgcolor: combineRgb(40, 60, 80) },
			timer_minus_1: { name: 'Timer -1 min', actionId: 'adjust_timer_minus_1', text: '-1', bgcolor: combineRgb(40, 60, 80) },
			timer_plus_5: { name: 'Timer +5 min', actionId: 'adjust_timer_plus_5', text: '+5', bgcolor: combineRgb(40, 60, 80) },
			timer_minus_5: { name: 'Timer -5 min', actionId: 'adjust_timer_minus_5', text: '-5', bgcolor: combineRgb(40, 60, 80) },
		}
		for (const [id, def] of Object.entries(timerPresets)) {
			presets[id] = {
				type: 'button',
				category: 'Timer',
				name: def.name,
				style: {
					text: def.text,
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: def.bgcolor,
				},
				feedbacks: [],
				steps: [
					{
						down: [{ actionId: def.actionId, options: {} }],
						up: [],
					},
				],
			}
		}

		// Stop all sub-timers (single preset)
		presets.stop_subtimer_all = {
			type: 'button',
			category: 'Timer',
			name: 'Stop all sub-timers',
			style: {
				text: 'Stop subs',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(100, 50, 0),
			},
			feedbacks: [],
			steps: [
				{
					down: [{ actionId: 'stop_subtimer', options: { itemId: '' } }],
					up: [],
				},
			],
		}

		// One preset per sub-cue only for Start Sub-Timer
		for (const item of subCues) {
			const cueDisplay = this.formatCueDisplay(item.customFields?.cue, item.id)
			const fullLabel = `Sub: ${cueDisplay} – ${item.segmentName || 'Untitled'}`
			presets[`sub_${item.id}`] = {
				type: 'button',
				category: 'Sub-Timers',
				name: fullLabel,
				style: {
					text: `Sub ${cueDisplay}`,
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(60, 40, 80),
				},
				feedbacks: [],
				steps: [
					{
						down: [{ actionId: 'start_subtimer', options: { itemId: String(item.id) } }],
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
		const syncActive = this.pollInterval != null ? 'Yes' : 'No'
		const eventId = this.config?.eventId
		if (!eventId) {
			this.setVariableValues({ sync_active: syncActive })
			return
		}

		const event = this.events.find((e) => String(e.id) === String(eventId))
		const currentItem = this.scheduleItems.find((s) => String(s.id) === String(this.activeTimer?.item_id))
		const cueLabel = currentItem ? this.formatCueDisplay(currentItem.customFields?.cue ?? this.activeTimer?.cue_is, currentItem.id) : (this.activeTimer?.cue_is ?? '—')
		const segmentName = currentItem?.segmentName ?? '—'
		const loadedCueValue = currentItem?.customFields?.value ?? segmentName ?? '—'
		const timerRunning = this.activeTimer?.is_running === true

		const values = {
			sync_active: syncActive,
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
