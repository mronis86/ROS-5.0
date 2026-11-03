const { InstanceBase, runEntrypoint, InstanceStatus, combineRgb } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')
const { sendRossTalkCommand } = require('./ross-talk')
const {
	normalizeDsmLayoutMode,
	effectiveDsmLayoutMode,
	dsmLayoutLabel,
} = require('./dsm-layout')

class RunOfShowInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.events = []
		this.scheduleItems = []
		this.allScheduleItems = []
		this.activeTimer = null
		this.pollInterval = null
		this.autoDisableTimeout = null
		this.timerTickInterval = null
		this.rossTalkWatchInterval = null
		this.refreshStartedAt = null
		this.syncPausedByTimer = false
		this._dsmWatchPrev = null
		this.lastDsmMode = ''
		this.lastRossTalkStatus = '—'
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
		this.startTimerTick()
		this.startRossTalkTimerWatch()
		this.updateStatus(InstanceStatus.Ok)
	}

	async destroy() {
		if (this.pollInterval) clearInterval(this.pollInterval)
		if (this.autoDisableTimeout) clearTimeout(this.autoDisableTimeout)
		if (this.timerTickInterval) clearInterval(this.timerTickInterval)
		if (this.rossTalkWatchInterval) clearInterval(this.rossTalkWatchInterval)
	}

	async configUpdated(config) {
		this.config = config
		this.refreshStartedAt = Date.now()
		this._dsmWatchPrev = null
		this.updateStatus(InstanceStatus.Connecting)
		await this.fetchData()
		if (this.getSyncIntervalEnabled()) this.startPolling()
		else if (this.pollInterval) {
			clearInterval(this.pollInterval)
			this.pollInterval = null
		}
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.updateVariableValues()
		this.checkAllFeedbacks()
		this.startTimerTick()
		this.startRossTalkTimerWatch()
		this.updateStatus(InstanceStatus.Ok)
	}

	// Update timer display variables and adaptive timer feedback every second when timer is running
	startTimerTick() {
		if (this.timerTickInterval) clearInterval(this.timerTickInterval)
		const self = this
		this.timerTickInterval = setInterval(() => {
			if (self.activeTimer?.is_running === true) {
				self.updateVariableValues()
				self.checkFeedbacks('button_text_timer_adaptive')
			}
		}, 1000)
	}

	getApiUrl() {
		const url = (this.config?.apiUrl || '').trim().replace(/\/+$/, '')
		return url || 'https://ros-50-production.up.railway.app'
	}

	getAuthHeaders() {
		const token = (this.config?.apiToken || '').trim()
		if (!token) return {}
		return { Authorization: `Bearer ${token}` }
	}

	async fetch(url, options = {}) {
		const baseUrl = this.getApiUrl()
		const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`
		try {
			const res = await fetch(fullUrl, {
				...options,
				headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders(), ...options.headers },
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
			this.allScheduleItems = []
			return []
		}
		let items = typeof data.schedule_items === 'string' ? JSON.parse(data.schedule_items) : data.schedule_items
		if (!Array.isArray(items)) items = []
		this.allScheduleItems = items
		const dayNum = parseInt(day, 10) || 1
		this.scheduleItems = items.filter((item) => (item.day || 1) === dayNum)
		return this.scheduleItems
	}

	findScheduleItem(itemId) {
		const id = String(itemId)
		return (
			(this.allScheduleItems || []).find((s) => String(s.id) === id) ||
			(this.scheduleItems || []).find((s) => String(s.id) === id) ||
			null
		)
	}

	isRossTalkEnabled() {
		const v = this.config?.rossTalkEnabled
		return v === true || v === 'true'
	}

	isRossTalkOnCueLoad() {
		if (!this.isRossTalkEnabled()) return false
		const v = this.config?.rossTalkOnCueLoad
		return v !== false && v !== 'false'
	}

	getRossTalkCommandForMode(mode) {
		const m = normalizeDsmLayoutMode(mode)
		const cfg = this.config || {}
		if (m === 'full') return String(cfg.rossTalkCmdFull || '').trim()
		if (m === 'vid') return String(cfg.rossTalkCmdVid || '').trim()
		if (m === 'ppt') return String(cfg.rossTalkCmdPpt || '').trim()
		return String(cfg.rossTalkCmdLed || '').trim()
	}

	async sendDsmRossTalk(mode) {
		if (!this.isRossTalkEnabled()) {
			this.lastRossTalkStatus = 'disabled'
			return false
		}
		const normalized = normalizeDsmLayoutMode(mode)
		const command = this.getRossTalkCommandForMode(normalized)
		if (!command) {
			this.lastRossTalkStatus = `no cmd (${normalized})`
			this.log('warn', `Ross Talk: no command configured for ${dsmLayoutLabel(normalized)}`)
			this.updateVariableValues()
			return false
		}
		const host = String(this.config?.rossTalkHost || '').trim()
		const port = parseInt(this.config?.rossTalkPort, 10) || 7788
		try {
			await sendRossTalkCommand({ host, port, command })
			this.lastDsmMode = normalized
			this.lastRossTalkStatus = `ok ${normalized}`
			this.log('info', `Ross Talk sent (${dsmLayoutLabel(normalized)}): ${command}`)
			this.updateVariableValues()
			return true
		} catch (err) {
			this.lastRossTalkStatus = `err ${err.message}`
			this.log('error', `Ross Talk failed (${normalized}): ${err.message}`)
			this.updateVariableValues()
			return false
		}
	}

	/** Push DSM Clock layout (API) and/or Ross Talk for a mode. */
	async applyDsmMode(mode, { layout = true, rossTalk = true } = {}) {
		const normalized = normalizeDsmLayoutMode(mode)
		const eventId = this.config?.eventId
		if (layout && eventId) {
			try {
				await this.apiPost('/api/dsm-clock/layout', { event_id: eventId, mode: normalized })
				this.lastDsmMode = normalized
				this.log('info', `DSM Clock layout set to ${normalized}`)
			} catch (err) {
				this.log('error', `DSM Clock layout failed: ${err.message}`)
			}
		}
		if (rossTalk) {
			await this.sendDsmRossTalk(normalized)
		} else {
			this.lastDsmMode = normalized
		}
		this.updateVariableValues()
		return normalized
	}

	/**
	 * On cue load: if the row has DSM enabled, send its mode via Ross Talk.
	 * force=true always sends (manual preset), ignoring the row checkbox.
	 */
	async fireDsmRossTalkForItem(itemId, { force = false, mode: modeOverride } = {}) {
		const item = this.findScheduleItem(itemId)
		if (!force && item?.dsmEnabled !== true) {
			this.log('debug', `DSM Ross Talk skipped — DSM not enabled on item ${itemId}`)
			return false
		}
		const mode =
			modeOverride != null
				? normalizeDsmLayoutMode(modeOverride)
				: item
					? effectiveDsmLayoutMode(item)
					: 'led'
		// Cue-load path: server already set DSM Clock layout; Companion only needs Ross Talk.
		// Manual force still sends layout when called via applyDsmMode from actions.
		if (force) {
			await this.applyDsmMode(mode, { layout: true, rossTalk: true })
		} else {
			await this.sendDsmRossTalk(mode)
		}
		return true
	}

	/** Watch active timer for cue-load changes (ROS / OSC / other clients). */
	startRossTalkTimerWatch() {
		if (this.rossTalkWatchInterval) {
			clearInterval(this.rossTalkWatchInterval)
			this.rossTalkWatchInterval = null
		}
		if (!this.isRossTalkOnCueLoad()) return
		const self = this
		const ms = Math.max(1000, Math.min(10000, parseInt(this.config?.rossTalkWatchSeconds, 10) * 1000 || 2000))
		this.rossTalkWatchInterval = setInterval(() => {
			const eventId = self.config?.eventId
			if (!eventId) return
			self
				.fetchActiveTimer(eventId)
				.then(() => {
					self.maybeFireDsmRossTalkFromActiveTimer()
					self.updateVariableValues()
					self.checkAllFeedbacks()
				})
				.catch(() => {})
		}, ms)
		this.log('info', `Ross Talk cue-load watch every ${Math.round(ms / 1000)}s`)
	}

	maybeFireDsmRossTalkFromActiveTimer() {
		if (!this.isRossTalkOnCueLoad()) return
		const t = this.activeTimer
		if (!t || t.item_id == null) return
		const itemId = String(t.item_id)
		const state = String(t.timer_state || '')
		if (state !== 'loaded' && state !== 'running') return

		const prev = this._dsmWatchPrev
		if (!prev) {
			// Arm on first sample so Companion start does not blast the current cue
			this._dsmWatchPrev = { itemId, state }
			return
		}
		const itemChanged = prev.itemId !== itemId
		const becameLoaded = state === 'loaded' && prev.state !== 'loaded'
		this._dsmWatchPrev = { itemId, state }
		if (!itemChanged && !becameLoaded) return
		void this.fireDsmRossTalkForItem(itemId, { force: false })
	}

	itemDurationSeconds(item) {
		if (!item) return 300
		const fromParts =
			(Number(item.durationHours) || 0) * 3600 +
			(Number(item.durationMinutes) || 0) * 60 +
			(Number(item.durationSeconds) || 0)
		if (fromParts > 0) return fromParts
		const fromSec = Number(item.duration_seconds)
		return Number.isFinite(fromSec) && fromSec > 0 ? Math.floor(fromSec) : 300
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
			this.allScheduleItems = []
			this.activeTimer = null
			return
		}
		try {
			await this.fetchEvents()
			await this.fetchRunOfShow(eventId, this.config?.day || 1)
			await this.fetchActiveTimer(eventId)
			this.maybeFireDsmRossTalkFromActiveTimer()
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
			headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
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
			headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
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
		const res = await fetch(`${baseUrl}${path}`, {
			method: 'DELETE',
			headers: { ...this.getAuthHeaders() },
		})
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
				id: 'apiToken',
				label: 'API Token (optional until auth enforced)',
				width: 12,
				tooltip: 'Integration token from Admin → Integration API tokens. Required when Railway REQUIRE_API_AUTH is enabled.',
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
			{
				type: 'static-text',
				id: 'rossTalkHeading',
				label: 'Ross Talk (DSM)',
				width: 12,
				value:
					'Send Ross Talk TCP commands when a DSM-enabled cue loads (or via DSM presets). Fill in the exact strings your switcher expects.',
			},
			{
				type: 'checkbox',
				id: 'rossTalkEnabled',
				label: 'Enable Ross Talk',
				width: 6,
				default: false,
				tooltip: 'When ON, this module opens a TCP connection and sends the command for the DSM mode.',
			},
			{
				type: 'checkbox',
				id: 'rossTalkOnCueLoad',
				label: 'Send on cue load (DSM-enabled rows)',
				width: 6,
				default: true,
				tooltip:
					'When ON, loading a cue that has the DSM column checkbox enabled sends that row’s Full/LED/VID/PPT command. Works for loads from ROS, OSC, or Companion.',
			},
			{
				type: 'textinput',
				id: 'rossTalkHost',
				label: 'Ross Talk host / IP',
				width: 8,
				default: '',
				tooltip: 'Switcher or Ross Talk listener IP (e.g. Carbonite / Ultrix / openGear).',
			},
			{
				type: 'number',
				id: 'rossTalkPort',
				label: 'Ross Talk port',
				width: 4,
				default: 7788,
				min: 1,
				max: 65535,
				tooltip: 'Default Ross Talk port is 7788.',
			},
			{
				type: 'number',
				id: 'rossTalkWatchSeconds',
				label: 'Cue-load watch (seconds)',
				width: 4,
				default: 2,
				min: 1,
				max: 10,
				tooltip: 'How often to check active timer for cue loads from ROS/OSC (when Send on cue load is ON).',
			},
			{
				type: 'textinput',
				id: 'rossTalkCmdFull',
				label: 'Command · Full DSM',
				width: 12,
				default: '',
				tooltip: 'Ross Talk string for Full DSM (leave blank to skip).',
			},
			{
				type: 'textinput',
				id: 'rossTalkCmdLed',
				label: 'Command · LED DSM',
				width: 12,
				default: '',
				tooltip: 'Ross Talk string for LED DSM (leave blank to skip).',
			},
			{
				type: 'textinput',
				id: 'rossTalkCmdVid',
				label: 'Command · VID DSM',
				width: 12,
				default: '',
				tooltip: 'Ross Talk string for VID DSM (leave blank to skip).',
			},
			{
				type: 'textinput',
				id: 'rossTalkCmdPpt',
				label: 'Command · PPT DSM',
				width: 12,
				default: '',
				tooltip: 'Ross Talk string for PPT DSM (leave blank to skip).',
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
		this.checkFeedbacks('timer_running', 'cue_loaded', 'loaded_cue_is', 'button_text_from_cue', 'button_text_timer_elapsed', 'button_text_timer_remaining', 'button_text_timer_duration', 'button_text_timer_adaptive')
	}

	// Return formatted timer display values for variables/feedbacks
	getTimerDisplayValues() {
		let elapsed = '—'
		let remaining = '—'
		let duration = '—'
		let isOvertime = false
		let overtimeFormatted = ''
		let elapsedSec = 0
		let remainingSec = 0
		let durSec = 300
		if (this.activeTimer && this.activeTimer.item_id != null) {
			durSec = this.activeTimer.duration_seconds ?? 300
			duration = this.formatTimerSeconds(durSec)
			if (this.activeTimer.is_running === true && this.activeTimer.started_at) {
				elapsedSec = Math.floor((Date.now() - new Date(this.activeTimer.started_at).getTime()) / 1000)
			} else {
				elapsedSec = this.activeTimer.elapsed_seconds ?? 0
			}
			remainingSec = durSec - elapsedSec
			elapsed = this.formatTimerSeconds(elapsedSec)
			remaining = this.formatTimerSeconds(Math.max(0, remainingSec))
			if (this.activeTimer.is_running === true && remainingSec < 0) {
				isOvertime = true
				overtimeFormatted = '+' + this.formatTimerSeconds(-remainingSec)
			}
		}
		return { elapsed, remaining, duration, isOvertime, overtimeFormatted, elapsedSec, remainingSec, durSec }
	}

	// Format seconds as M:SS or H:MM:SS (for durations >= 1 hour)
	formatTimerSeconds(seconds) {
		const s = Math.max(0, Math.floor(Number(seconds) || 0))
		if (s >= 3600) {
			const h = Math.floor(s / 3600)
			const m = Math.floor((s % 3600) / 60)
			const sec = s % 60
			return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
		}
		const m = Math.floor(s / 60)
		const sec = s % 60
		return `${m}:${String(sec).padStart(2, '0')}`
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

		presets.dsm_full = {
			type: 'button',
			category: 'DSM',
			name: 'DSM · Full',
			style: {
				text: 'DSM\nFull',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(51, 65, 85),
			},
			feedbacks: [],
			steps: [{ down: [{ actionId: 'dsm_mode_full', options: {} }], up: [] }],
		}
		presets.dsm_led = {
			type: 'button',
			category: 'DSM',
			name: 'DSM · LED',
			style: {
				text: 'DSM\nLED',
				size: 'auto',
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(52, 211, 153),
			},
			feedbacks: [],
			steps: [{ down: [{ actionId: 'dsm_mode_led', options: {} }], up: [] }],
		}
		presets.dsm_vid = {
			type: 'button',
			category: 'DSM',
			name: 'DSM · VID',
			style: {
				text: 'DSM\nVID',
				size: 'auto',
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(251, 191, 36),
			},
			feedbacks: [],
			steps: [{ down: [{ actionId: 'dsm_mode_vid', options: {} }], up: [] }],
		}
		presets.dsm_ppt = {
			type: 'button',
			category: 'DSM',
			name: 'DSM · PPT',
			style: {
				text: 'DSM\nPPT',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(79, 70, 229),
			},
			feedbacks: [],
			steps: [{ down: [{ actionId: 'dsm_mode_ppt', options: {} }], up: [] }],
		}
		// Legacy aliases
		presets.dsm_clock_16x9 = {
			type: 'button',
			category: 'DSM',
			name: 'DSM · 16:9 ON (legacy → LED)',
			style: {
				text: 'DSM\n16:9',
				size: 'auto',
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(245, 158, 11),
			},
			feedbacks: [],
			steps: [{ down: [{ actionId: 'dsm_clock_16x9', options: {} }], up: [] }],
		}
		presets.dsm_clock_full = {
			type: 'button',
			category: 'DSM',
			name: 'DSM · Full (legacy)',
			style: {
				text: 'DSM\nFull',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(51, 65, 85),
			},
			feedbacks: [],
			steps: [{ down: [{ actionId: 'dsm_clock_full', options: {} }], up: [] }],
		}

		// Timer display preset: adaptive – Duration (loaded) / Remaining (running) / Overtime (over). Two-line: label (small) \n value (large)
		presets.timer_display_adaptive = {
			type: 'button',
			category: 'Timer',
			name: 'Timer (Adaptive)',
			style: {
				text: 'Duration\n—',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(50, 50, 70),
			},
			feedbacks: [
				{
					feedbackId: 'button_text_timer_adaptive',
					options: { overtimeColor: 'red', labelStyle: 'short' },
					style: {},
				},
			],
			steps: [{ down: [], up: [] }],
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
		const timerDisplay = this.getTimerDisplayValues()

		const values = {
			sync_active: syncActive,
			current_cue: cueLabel,
			current_segment: segmentName,
			loaded_cue_value: loadedCueValue,
			timer_running: timerRunning ? 'Yes' : 'No',
			timer_elapsed: timerDisplay.elapsed,
			timer_remaining: timerDisplay.remaining,
			timer_duration: timerDisplay.duration,
			event_name: event?.name ?? '—',
			dsm_mode: this.lastDsmMode || '—',
			ross_talk_status: this.lastRossTalkStatus || '—',
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
