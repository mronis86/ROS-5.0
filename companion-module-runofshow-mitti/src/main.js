const { InstanceBase, runEntrypoint, InstanceStatus, combineRgb } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')
const {
	FEEDBACK,
	cueSelectAddress,
	cuePlayAddress,
	playPlaylistAddress,
	matchesAddress,
	parseTimecodeToSeconds,
	createUdpPort,
	sendOsc,
} = require('./mittiOsc')

/**
 * Mitti Sync — parallel option to Resolume Sync.
 *
 * Live timer: OSC feedback (cueTimeLeft / currentCueTRT) → one-shot mitti-sync-align.
 * TRT pull: Mitti only exposes TRT for the *current* cue, so we select → read → restore.
 */
class RunOfShowMittiInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.events = []
		this.scheduleItems = []
		this.indentedCueIds = new Set()
		this.activeTimer = null
		this.mittiArm = null
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
		this.durationSampleRequest = null
		/** Last Mitti cue number seen via OSC (for restore after TRT pull). */
		this.lastKnownMittiCueNumber = null
	}

	async init(config) {
		await this.applyConfig(config, true)
	}

	async destroy() {
		this.stopPeriodicAlign()
		this.cancelDurationSample()
		if (this.syncPulseTimeout) clearTimeout(this.syncPulseTimeout)
		this.closeOscListener()
		this.mittiArm = null
	}

	async configUpdated(config) {
		await this.applyConfig(config, false)
	}

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
		return Number.isFinite(p) && p > 0 ? p : 51001
	}

	getTimecodeFps() {
		const fps = parseInt(this.config?.timecodeFps, 10)
		return Number.isFinite(fps) && fps > 0 ? fps : 30
	}

	getSampleDelayMs() {
		const ms = parseInt(this.config?.sampleDelayMs, 10)
		return Number.isFinite(ms) && ms >= 30 ? ms : 120
	}

	getFollowUpAlignMs() {
		const ms = parseInt(this.config?.followUpAlignMs, 10)
		return Number.isFinite(ms) && ms >= 0 ? ms : 400
	}

	getCueEndAction() {
		const a = String(this.config?.cueEndAction || '').trim()
		if (a === 'stop' || a === 'none' || a === 'keep_running') return a
		return 'align_zero'
	}

	getCueEndThresholdSeconds() {
		const t = Number(this.config?.cueEndThresholdSeconds)
		return Number.isFinite(t) && t >= 0 && t <= 5 ? t : 0.5
	}

	getNetworkDelayMs() {
		const ms = parseInt(this.config?.networkDelayMs, 10)
		return Number.isFinite(ms) && ms >= 0 ? Math.min(15000, ms) : 800
	}

	getPeriodicAlignIntervalSeconds() {
		const s = parseInt(this.config?.periodicAlignIntervalSeconds, 10)
		return Number.isFinite(s) && s >= 0 ? s : 10
	}

	getMittiSendHost() {
		const host = String(this.config?.mittiSendHost || '').trim()
		return host || '127.0.0.1'
	}

	getMittiSendPort() {
		const p = parseInt(this.config?.mittiSendPort, 10)
		return Number.isFinite(p) && p > 0 ? p : 51000
	}

	getFetchTimeoutMs() {
		const ms = parseInt(this.config?.apiFetchTimeoutMs, 10)
		return Number.isFinite(ms) && ms >= 2000 ? Math.min(ms, 30000) : 8000
	}

	getScheduleDurationSeconds(itemId) {
		const item = this.scheduleItems.find((s) => String(s.id) === String(itemId))
		if (!item) return null
		const d =
			(item.durationHours || 0) * 3600 + (item.durationMinutes || 0) * 60 + (item.durationSeconds || 0)
		return d > 0 ? d : null
	}

	resolveCueDuration(arm) {
		if (arm.inferredDuration && arm.inferredDuration > 0) {
			return { duration: Math.round(arm.inferredDuration), source: 'osc-trt' }
		}
		if (arm.lastElapsed != null && arm.lastRemaining != null) {
			const total = arm.lastElapsed + arm.lastRemaining
			if (total > 0 && total <= 86400) {
				return { duration: Math.round(total), source: 'osc-elapsed+left' }
			}
		}
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
		if (this.mittiArm) {
			this.mittiArm.phase = 'aligned'
			this.mittiArm.inferredDuration = durationSeconds
		}
		this.updateVariableValues()
		this.checkFeedbacks('mitti_armed', 'mitti_aligned', 'mitti_sync_pulse')
		if (this.syncPulseTimeout) clearTimeout(this.syncPulseTimeout)
		this.syncPulseActive = true
		this.checkFeedbacks('mitti_sync_pulse')
		this.syncPulseTimeout = setTimeout(() => {
			this.syncPulseActive = false
			this.checkFeedbacks('mitti_sync_pulse')
		}, 2000)
	}

	getEstimatedDriftSeconds() {
		const arm = this.mittiArm
		if (arm?.lastRemaining == null) return null
		const rosRem = this.getRosRemainingSeconds()
		if (rosRem == null) return null
		return Math.round((rosRem - arm.lastRemaining) * 10) / 10
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
				const arm = self.mittiArm
				if (!arm || arm.phase !== 'aligned' || !arm.inferredDuration || arm.endTriggered) return
				if (arm.lastRemaining == null) return
				const eventId = self.config?.eventId
				if (eventId) {
					try {
						await self.fetchActiveTimer(eventId)
					} catch (_) {}
				}
				// Near end then suddenly full remaining — loop restart; skip reset
				if (
					arm.lastRemaining > arm.inferredDuration * 0.9 &&
					self.lastSyncRemaining != null &&
					self.lastSyncRemaining <= 20
				) {
					self.log('info', 'Skipping periodic align — cue near start after near-end playback')
					return
				}
				const mittiRem = arm.lastRemaining
				const rosRem = self.getRosRemainingSeconds()
				const drift =
					rosRem != null ? Math.round(Math.abs(rosRem - mittiRem) * 10) / 10 : null
				self.log(
					'info',
					`Periodic re-sync every ${sec}s (rem ${mittiRem}s${drift != null ? `, drift ${drift}s` : ''})`
				)
				await self.triggerMittiAlign(arm.inferredDuration, mittiRem, Date.now(), true, 'periodic')
			}
			run().catch((err) => self.log('warn', `Periodic align failed: ${err.message}`))
		}, sec * 1000)
	}

	sendMittiTrigger({ triggerMode, cueNumber }) {
		const host = this.getMittiSendHost()
		const port = this.getMittiSendPort()
		const cue = Math.max(1, parseInt(cueNumber, 10) || 1)
		const mode = triggerMode || 'cue'
		if (mode === 'select_then_play') {
			sendOsc(host, port, cueSelectAddress(cue))
			setTimeout(() => sendOsc(host, port, playPlaylistAddress()), 80)
			this.log('info', `Sent Mitti OSC select+play -> ${host}:${port} cue ${cue}`)
			return
		}
		if (mode === 'playlist') {
			sendOsc(host, port, playPlaylistAddress())
			this.log('info', `Sent Mitti OSC play -> ${host}:${port}`)
			return
		}
		sendOsc(host, port, cuePlayAddress(cue))
		this.log('info', `Sent Mitti OSC play cue -> ${host}:${port} ${cuePlayAddress(cue)}`)
	}

	sendMittiSelect(cueNumber) {
		const host = this.getMittiSendHost()
		const port = this.getMittiSendPort()
		const cue = Math.max(1, parseInt(cueNumber, 10) || 1)
		sendOsc(host, port, cueSelectAddress(cue))
		this.log('info', `Sent Mitti OSC select -> ${host}:${port} ${cueSelectAddress(cue)}`)
	}

	requestOscFeedbackResend() {
		const host = this.getMittiSendHost()
		const port = this.getMittiSendPort()
		sendOsc(host, port, FEEDBACK.RESEND_FEEDBACK)
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
		return this.fetch(path, { method: 'POST', body: JSON.stringify(body) })
	}

	async apiPut(path, body) {
		return this.fetch(path, { method: 'PUT', body: JSON.stringify(body) })
	}

	cancelDurationSample() {
		const req = this.durationSampleRequest
		if (!req) return
		if (req.timer) clearTimeout(req.timer)
		if (req.resolveEarly) {
			try {
				req.resolveEarly(null)
			} catch (_) {}
		}
		this.durationSampleRequest = null
	}

	/**
	 * Pull video TRT from Mitti without leaving the wrong cue selected.
	 * Flow: remember restore cue → select target → wait for currentCueTRT → restore.
	 * Use when a media file was replaced/updated and ROS duration needs refresh.
	 */
	sampleTrtFromMitti(cueNumber, options = {}) {
		const waitMs = Math.max(200, parseInt(options.waitMs, 10) || 600)
		const targetCue = Math.max(1, parseInt(cueNumber, 10) || 1)
		let restoreCue = parseInt(options.restoreCueNumber, 10)
		if (!Number.isFinite(restoreCue) || restoreCue < 1) {
			restoreCue = this.lastKnownMittiCueNumber
		}
		const itemId = options.itemId

		this.ensureOscListener()
		this.cancelDurationSample()

		this.log(
			'info',
			`Pulling Mitti TRT: select cue ${targetCue}` +
				(restoreCue ? `, then restore cue ${restoreCue}` : ' (no restore cue known)') +
				` — wait ${waitMs}ms`
		)

		this.sendMittiSelect(targetCue)
		setTimeout(() => this.requestOscFeedbackResend(), 50)

		return new Promise((resolve, reject) => {
			let settled = false
			const finish = (duration) => {
				if (settled) return
				settled = true
				this.durationSampleRequest = null
				if (restoreCue && restoreCue !== targetCue) {
					this.sendMittiSelect(restoreCue)
				}
				if (duration && duration >= 1) {
					this.lastInferredDuration = duration
					resolve(duration)
				} else {
					reject(
						new Error(
							`Could not read TRT for Mitti cue ${targetCue}. Enable OSC Feedback, or set duration manually.`
						)
					)
				}
			}

			const timer = setTimeout(() => {
				const req = this.durationSampleRequest
				let duration = req?.trt != null ? Math.round(req.trt) : null
				if (!duration && itemId) duration = this.getScheduleDurationSeconds(itemId)
				finish(duration)
			}, waitMs)

			this.durationSampleRequest = {
				timer,
				trt: null,
				targetCue,
				resolveEarly: (dur) => {
					if (dur != null && dur >= 1) {
						clearTimeout(timer)
						finish(Math.round(dur))
					}
				},
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

	async runArmMittiSync(options, { requireSubCue }) {
		const eventId = this.config?.eventId
		const itemId = options.itemId
		const cueNumber = Math.max(1, parseInt(options.cueNumber, 10) || 1)
		const triggerOnArm = options.triggerOnArm === true
		const triggerMode = options.triggerMode || 'cue'
		if (!eventId || !itemId) {
			this.log('warn', 'Arm Mitti: Event ID and cue are required')
			return
		}
		const item = this.scheduleItems.find((s) => String(s.id) === String(itemId))
		const isSub = this.isScheduleItemSubCue(item)
		if (requireSubCue && !isSub) {
			this.log('warn', 'Arm sub-cue: select an indented sub-cue row')
			return
		}
		if (!requireSubCue && isSub) {
			this.log('warn', 'Arm Mitti: use a main cue row, not a sub-cue')
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
			await this.loadCueForMitti(eventId, loadItemId, { forSubCueParent: !!requireSubCue })
			this.setMittiArm({ itemId: String(armTrackItemId), cueNumber, isSubCue: !!requireSubCue })
			await this.notifyMittiArm(armTrackItemId, { isSubCue: requireSubCue })
			if (triggerOnArm) {
				this.sendMittiTrigger({ triggerMode, cueNumber })
			}
			this.ensureOscListener()
			this.updateVariableValues()
			this.checkFeedbacks('mitti_armed')
			const cueDisplay = this.formatCueDisplay(item?.customFields?.cue, itemId)
			this.log(
				'info',
				`Mitti sync armed for ${requireSubCue ? 'sub-cue' : 'cue'} ${cueDisplay} (Mitti cue ${cueNumber}; loaded ${loadItemId})`
			)
		} catch (err) {
			this.log('error', `Arm Mitti failed: ${err.message}`)
		}
	}

	async runSetCueDurationFromMitti(options, { requireSubCue }) {
		const eventId = this.config?.eventId
		const itemId = options.itemId
		const cueNumber = Math.max(1, parseInt(options.cueNumber, 10) || 1)
		if (!eventId || !itemId) {
			this.log('warn', 'Pull TRT: Event ID and cue are required')
			return
		}
		const item = this.scheduleItems.find((s) => String(s.id) === String(itemId))
		const isSub = this.isScheduleItemSubCue(item)
		if (requireSubCue && !isSub) {
			this.log('warn', 'Pull TRT sub-cue: select an indented sub-cue row')
			return
		}
		if (!requireSubCue && isSub) {
			this.log('warn', 'Pull TRT main cue: use the sub-cue action for indented rows')
			return
		}
		try {
			let dur = parseInt(options.durationSeconds, 10)
			if (!Number.isFinite(dur) || dur < 1) {
				dur = await this.sampleTrtFromMitti(cueNumber, {
					waitMs: options.sampleMs,
					restoreCueNumber: options.restoreCueNumber,
					itemId: String(itemId),
				})
			}
			const applied = await this.putCueDurationSeconds(eventId, itemId, dur)
			const cueDisplay = this.formatCueDisplay(item?.customFields?.cue, itemId)
			this.log(
				'info',
				`Updated ${requireSubCue ? 'sub-cue' : 'cue'} ${cueDisplay} duration to ${applied}s from Mitti cue ${cueNumber} TRT`
			)
		} catch (err) {
			this.log('error', `Pull TRT failed: ${err.message}`)
		}
	}

	async loadCueForMitti(eventId, itemId, { forSubCueParent = false } = {}) {
		await this.fetchActiveTimer(eventId)
		await this.stopAllSubCueTimers(eventId)

		const targetId = String(itemId)
		const activeId = this.activeTimer?.item_id != null ? String(this.activeTimer.item_id) : null
		const activeRunning =
			this.activeTimer?.is_running === true || this.activeTimer?.timer_state === 'running'

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
			user_id: 'companion-mitti',
			cue_is: cueIs,
			duration_seconds: dur ?? 300,
		})
		await this.fetchActiveTimer(eventId)
		this.updateVariableValues()
	}

	async notifyMittiArm(itemId, { isSubCue = false } = {}) {
		const eventId = this.config?.eventId
		if (!eventId || !itemId) return
		try {
			await this.apiPost('/api/timers/mitti-arm', {
				event_id: eventId,
				item_id: parseInt(itemId, 10),
				is_sub_cue: !!isSubCue,
			})
		} catch (err) {
			this.log('warn', `mitti-arm notify failed: ${err.message}`)
		}
	}

	setMittiArm({ itemId, cueNumber, isSubCue = false }) {
		const scheduleDurationSeconds = this.getScheduleDurationSeconds(itemId)
		this.mittiArm = {
			itemId: String(itemId),
			isSubCue: !!isSubCue,
			cueNumber: Math.max(1, parseInt(cueNumber, 10) || 1),
			phase: 'idle',
			sampleStartMs: 0,
			scheduleDurationSeconds,
			inferredDuration: null,
			lastRemaining: null,
			lastElapsed: null,
			lastFeedbackMs: 0,
			isPlaying: false,
			endTriggered: false,
			followUpScheduled: false,
			usedScheduleFallback: false,
			oscMsgCount: 0,
		}
		this.alignInFlight = false
		this.log(
			'info',
			`Watching Mitti OSC feedback on port ${this.getOscListenPort()} (cue ${cueNumber}; schedule ${scheduleDurationSeconds ?? 'unknown'}s)`
		)
	}

	async clearMittiArm() {
		this.stopPeriodicAlign()
		const eventId = this.config?.eventId
		this.mittiArm = null
		this.alignInFlight = false
		if (eventId) {
			this.apiPost('/api/timers/mitti-disarm', { event_id: eventId }).catch(() => {})
		}
		this.updateVariableValues()
		this.checkFeedbacks('mitti_armed', 'mitti_aligned')
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
		const fps = this.getTimecodeFps()

		// Track current cue number from select-style feedback paths like /mitti/3/...
		const cuePathMatch = String(address || '').match(/^\/mitti\/(\d+)\//i)
		if (cuePathMatch) {
			this.lastKnownMittiCueNumber = parseInt(cuePathMatch[1], 10)
		}

		const durSample = this.durationSampleRequest
		if (durSample && matchesAddress(address, FEEDBACK.CURRENT_CUE_TRT)) {
			const trt = parseTimecodeToSeconds(value, fps)
			if (trt != null && trt > 0) {
				durSample.trt = trt
				if (typeof durSample.resolveEarly === 'function') {
					durSample.resolveEarly(trt)
				}
			}
		}

		if (!this.mittiArm) return
		const arm = this.mittiArm

		arm.oscMsgCount = (arm.oscMsgCount || 0) + 1
		if (arm.oscMsgCount <= 8) {
			this.log('info', `OSC #${arm.oscMsgCount}: ${address} = ${value}`)
		}

		if (matchesAddress(address, FEEDBACK.TOGGLE_PLAY)) {
			const playing = Number(value) >= 1
			arm.isPlaying = playing
			if (playing && arm.phase !== 'aligned') {
				arm.phase = 'sampling'
				arm.sampleStartMs = Date.now()
				arm.endTriggered = false
			}
		}

		if (matchesAddress(address, FEEDBACK.CURRENT_CUE_TRT)) {
			const trt = parseTimecodeToSeconds(value, fps)
			if (trt != null && trt > 0) {
				arm.inferredDuration = trt
				this.lastInferredDuration = trt
			}
		}

		if (matchesAddress(address, FEEDBACK.CUE_TIME_ELAPSED)) {
			const elapsed = parseTimecodeToSeconds(value, fps)
			if (elapsed != null) arm.lastElapsed = elapsed
		}

		if (!matchesAddress(address, FEEDBACK.CUE_TIME_LEFT)) return

		const rem = parseTimecodeToSeconds(value, fps)
		if (rem == null) return
		arm.lastRemaining = rem
		arm.lastFeedbackMs = Date.now()

		if (arm.phase === 'aligned') {
			if (!arm.endTriggered && rem <= this.getCueEndThresholdSeconds()) {
				const action = this.getCueEndAction()
				if (action === 'align_zero') {
					this.triggerCueEndAlignZero().catch((err) => {
						this.log('error', `Cue end align failed: ${err.message}`)
					})
				} else if (action === 'stop' || action === 'none') {
					this.triggerCueEndStop().catch((err) => {
						this.log('error', `Cue end stop failed: ${err.message}`)
					})
				} else if (action === 'keep_running') {
					this.triggerCueEndRelease().catch((err) => {
						this.log('error', `Cue end release failed: ${err.message}`)
					})
				}
			}
			return
		}

		if (this.alignInFlight) return

		if (arm.phase === 'idle' && (arm.isPlaying || rem > 0)) {
			arm.phase = 'sampling'
			arm.sampleStartMs = Date.now()
		}
		if (arm.phase !== 'sampling') return

		const resolved = this.resolveCueDuration(arm)
		if (!resolved) {
			const elapsed = Date.now() - arm.sampleStartMs
			if (elapsed > 3000 && !arm.alignTimeoutLogged) {
				arm.alignTimeoutLogged = true
				this.log(
					'warn',
					`No align yet — enable Mitti OSC Feedback → this PC port ${this.getOscListenPort()}`
				)
			}
			return
		}

		const windowMs = this.getSampleDelayMs()
		const elapsed = Date.now() - arm.sampleStartMs
		if (resolved.source !== 'schedule' && elapsed < windowMs) return
		if (resolved.source === 'schedule' && elapsed < 40) return
		if (resolved.source === 'schedule' && !arm.usedScheduleFallback) {
			arm.usedScheduleFallback = true
			this.log(
				'info',
				`Sync using schedule duration ${resolved.duration}s (waiting for Mitti TRT while playing)`
			)
		}

		this.triggerMittiAlign(resolved.duration, rem, Date.now(), false, 'initial').catch((err) => {
			this.log('error', `Mitti align failed: ${err.message}`)
			arm.phase = 'idle'
			this.alignInFlight = false
		})
	}

	scheduleFollowUpAlign() {
		const arm = this.mittiArm
		const delayMs = this.getFollowUpAlignMs()
		if (!arm || delayMs <= 0 || arm.followUpScheduled) return
		arm.followUpScheduled = true
		const self = this
		setTimeout(() => {
			const a = self.mittiArm
			if (!a || a.phase !== 'aligned' || !a.inferredDuration || a.lastRemaining == null) return
			self.triggerMittiAlign(a.inferredDuration, a.lastRemaining, a.lastFeedbackMs, true, 'follow-up').catch(
				(err) => self.log('warn', `Follow-up align failed: ${err.message}`)
			)
		}, delayMs)
		const extraMs = parseInt(this.config?.followUpAlignMs2, 10)
		if (Number.isFinite(extraMs) && extraMs > delayMs) {
			setTimeout(() => {
				const a = self.mittiArm
				if (!a || a.phase !== 'aligned' || !a.inferredDuration || a.lastRemaining == null) return
				self.triggerMittiAlign(
					a.inferredDuration,
					a.lastRemaining,
					a.lastFeedbackMs,
					true,
					'follow-up-2'
				).catch(() => {})
			}, extraMs)
		}
	}

	async stopSubCueMittiAtCueEnd(eventId, itemId) {
		await this.apiPut('/api/sub-cue-timers/stop', {
			event_id: eventId,
			item_id: parseInt(itemId, 10),
		})
	}

	async triggerCueEndAlignZero() {
		const arm = this.mittiArm
		const eventId = this.config?.eventId
		if (!arm || arm.endTriggered || !eventId || !arm.inferredDuration) return
		arm.endTriggered = true
		const dur = arm.inferredDuration
		const itemId = parseInt(arm.itemId, 10)
		try {
			if (arm.isSubCue) {
				await this.triggerMittiAlign(dur, 0, arm.lastFeedbackMs || Date.now(), true, 'cue-end')
				await this.stopSubCueMittiAtCueEnd(eventId, itemId)
				await this.apiPost('/api/timers/mitti-end', { event_id: eventId })
				this.stopPeriodicAlign()
				this.mittiArm = null
				this.updateVariableValues()
				this.checkFeedbacks('mitti_armed', 'mitti_aligned')
				this.log('info', `Cue ended — sub-cue ${itemId} stopped at 0`)
				return
			}
			await this.triggerMittiAlign(dur, 0, arm.lastFeedbackMs || Date.now(), true, 'cue-end')
			await this.apiPost('/api/timers/mitti-end', { event_id: eventId })
			this.stopPeriodicAlign()
			this.mittiArm = null
			this.updateVariableValues()
			this.checkFeedbacks('mitti_armed', 'mitti_aligned')
			await this.fetchActiveTimer(eventId)
			this.log('info', 'Cue ended — timer synced to 0 (overtime allowed)')
		} catch (err) {
			arm.endTriggered = false
			throw err
		}
	}

	async triggerCueEndStop() {
		const arm = this.mittiArm
		const eventId = this.config?.eventId
		if (!arm || arm.endTriggered || !eventId) return
		arm.endTriggered = true
		const itemId = parseInt(arm.itemId, 10)
		try {
			if (arm.isSubCue) {
				await this.stopSubCueMittiAtCueEnd(eventId, itemId)
			} else {
				await this.apiPost('/api/timers/stop', { event_id: eventId, item_id: itemId })
			}
			await this.apiPost('/api/timers/mitti-end', { event_id: eventId })
			this.clearMittiArm()
			await this.fetchActiveTimer(eventId)
			this.log(
				'info',
				arm.isSubCue ? `Cue ended — sub-cue ${itemId} stopped` : `Cue ended — timer stopped for item ${itemId}`
			)
		} catch (err) {
			arm.endTriggered = false
			throw err
		}
	}

	async triggerCueEndRelease() {
		const arm = this.mittiArm
		const eventId = this.config?.eventId
		if (!arm || arm.endTriggered || !eventId) return
		arm.endTriggered = true
		const itemId = parseInt(arm.itemId, 10)
		try {
			if (arm.isSubCue) {
				await this.stopSubCueMittiAtCueEnd(eventId, itemId)
			}
			await this.apiPost('/api/timers/mitti-end', { event_id: eventId })
			this.stopPeriodicAlign()
			this.mittiArm = null
			this.updateVariableValues()
			this.checkFeedbacks('mitti_armed', 'mitti_aligned')
			await this.fetchActiveTimer(eventId)
			this.log(
				'info',
				arm.isSubCue
					? `Cue ended — sub-cue ${itemId} stopped`
					: 'Cue ended — released Mitti lock (timer still running)'
			)
		} catch (err) {
			arm.endTriggered = false
			throw err
		}
	}

	async triggerMittiAlign(durationSeconds, remainingSeconds, alignAtMs, isFollowUp = false, reason = 'align') {
		if (this.alignInFlight || !this.mittiArm) return
		this.alignInFlight = true
		const eventId = this.config?.eventId
		const itemId = this.mittiArm.itemId
		const item = this.scheduleItems.find((s) => String(s.id) === String(itemId))
		const cueIs = item?.customFields?.cue ?? `CUE ${itemId}`
		const isSubCue = this.mittiArm?.isSubCue === true || this.isScheduleItemSubCue(item)

		try {
			await this.postMittiAlign({
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

	async postMittiAlign({
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
		await this.apiPost('/api/timers/mitti-sync-align', {
			event_id: eventId,
			item_id: parseInt(itemId, 10),
			user_id: 'companion-mitti',
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
				tooltip: 'Run of Show Railway API URL (must include mitti-* routes)',
			},
			{
				type: 'number',
				id: 'apiFetchTimeoutMs',
				label: 'API fetch timeout (ms)',
				width: 6,
				default: 8000,
				min: 2000,
				max: 30000,
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
				label: 'OSC listen port (Mitti feedback → Companion)',
				width: 6,
				default: 51001,
				min: 1024,
				max: 65535,
				tooltip: 'Mitti OSC Feedback target port on this Companion PC',
			},
			{
				type: 'textinput',
				id: 'mittiSendHost',
				label: 'Mitti host (OSC input)',
				width: 8,
				default: '127.0.0.1',
			},
			{
				type: 'number',
				id: 'mittiSendPort',
				label: 'Mitti OSC input port',
				width: 4,
				default: 51000,
				min: 1,
				max: 65535,
			},
			{
				type: 'number',
				id: 'timecodeFps',
				label: 'Timecode FPS (hh:mm:ss:ff)',
				width: 6,
				default: 30,
				min: 23,
				max: 60,
			},
			{
				type: 'number',
				id: 'sampleDelayMs',
				label: 'First-align sample window (ms)',
				width: 6,
				default: 120,
				min: 30,
				max: 2000,
			},
			{
				type: 'number',
				id: 'followUpAlignMs',
				label: 'Follow-up align #1 (ms)',
				width: 6,
				default: 400,
				min: 0,
				max: 5000,
			},
			{
				type: 'number',
				id: 'followUpAlignMs2',
				label: 'Follow-up align #2 (ms)',
				width: 6,
				default: 1200,
				min: 0,
				max: 10000,
			},
			{
				type: 'number',
				id: 'periodicAlignIntervalSeconds',
				label: 'Periodic re-sync interval (seconds)',
				width: 6,
				default: 10,
				min: 0,
				max: 120,
				tooltip: '0 = off. Re-sync while cue is playing',
			},
			{
				type: 'dropdown',
				id: 'cueEndAction',
				label: 'When cue reaches end',
				width: 12,
				default: 'align_zero',
				choices: [
					{ id: 'align_zero', label: 'Sync to 0:00 and keep running (overtime OK)' },
					{ id: 'stop', label: 'Stop timer at cue end' },
					{ id: 'none', label: 'Do nothing — stop timer (no overtime)' },
					{ id: 'keep_running', label: 'Release Mitti lock only (timer keeps running)' },
				],
			},
			{
				type: 'number',
				id: 'cueEndThresholdSeconds',
				label: 'Cue end threshold (seconds left)',
				width: 6,
				default: 0.5,
				min: 0,
				max: 5,
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
					'If ROS shows MORE time than Mitti, lower this. If LESS, raise it (try 500–1500).',
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
		this.checkFeedbacks('mitti_armed', 'mitti_aligned', 'mitti_sync_pulse')
	}

	updatePresets() {
		const presets = {
			arm_mitti_generic: {
				type: 'button',
				category: 'Mitti',
				name: 'Arm Mitti sync (select cue)',
				style: {
					text: 'Arm+Load\n(Select Cue)',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(180, 90, 40),
				},
				feedbacks: [
					{
						feedbackId: 'mitti_armed',
						options: {},
						style: { bgcolor: combineRgb(160, 80, 200), color: combineRgb(255, 255, 255) },
					},
					{
						feedbackId: 'mitti_aligned',
						options: {},
						style: { bgcolor: combineRgb(0, 140, 60), color: combineRgb(255, 255, 255) },
					},
					{
						feedbackId: 'mitti_sync_pulse',
						options: {},
						style: { bgcolor: combineRgb(0, 180, 220), color: combineRgb(0, 0, 0) },
					},
				],
				steps: [
					{
						down: [
							{
								actionId: 'arm_mitti_sync',
								options: { itemId: '', cueNumber: 1, triggerOnArm: true, triggerMode: 'cue' },
							},
						],
						up: [],
					},
				],
			},
			disarm_mitti: {
				type: 'button',
				category: 'Mitti',
				name: 'Disarm Mitti sync',
				style: {
					text: 'Disarm',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(80, 80, 80),
				},
				feedbacks: [],
				steps: [{ down: [{ actionId: 'disarm_mitti_sync', options: {} }], up: [] }],
			},
			pull_trt: {
				type: 'button',
				category: 'Mitti TRT',
				name: 'Pull TRT into cue (select → restore)',
				style: {
					text: 'Pull TRT\n→ ROS dur',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(60, 100, 140),
				},
				feedbacks: [],
				steps: [
					{
						down: [
							{
								actionId: 'mitti_pull_trt',
								options: {
									itemId: '',
									cueNumber: 1,
									restoreCueNumber: 0,
									sampleMs: 600,
									durationSeconds: 0,
								},
							},
						],
						up: [],
					},
				],
			},
			end_mitti: {
				type: 'button',
				category: 'Mitti',
				name: 'End Mitti sync',
				style: {
					text: 'End\nMitti',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(120, 60, 0),
				},
				feedbacks: [],
				steps: [{ down: [{ actionId: 'end_mitti_sync', options: {} }], up: [] }],
			},
		}

		for (const item of this.getRegularCues()) {
			const cueDisplay = this.formatCueDisplay(item.customFields?.cue, item.id)
			presets[`arm_cue_${item.id}`] = {
				type: 'button',
				category: 'Mitti Cues',
				name: `Arm + Load ${cueDisplay}`,
				style: {
					text: `${cueDisplay}\nArm+Load`,
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(160, 80, 35),
				},
				feedbacks: [
					{
						feedbackId: 'mitti_armed',
						options: {},
						style: { bgcolor: combineRgb(160, 80, 200), color: combineRgb(255, 255, 255) },
					},
					{
						feedbackId: 'mitti_aligned',
						options: {},
						style: { bgcolor: combineRgb(0, 140, 60), color: combineRgb(255, 255, 255) },
					},
					{
						feedbackId: 'mitti_sync_pulse',
						options: {},
						style: { bgcolor: combineRgb(0, 180, 220), color: combineRgb(0, 0, 0) },
					},
				],
				steps: [
					{
						down: [
							{
								actionId: 'arm_mitti_sync',
								options: {
									itemId: String(item.id),
									cueNumber: 1,
									triggerOnArm: true,
									triggerMode: 'cue',
								},
							},
						],
						up: [],
					},
				],
			}
			presets[`pull_trt_${item.id}`] = {
				type: 'button',
				category: 'Mitti TRT',
				name: `Pull TRT — ${cueDisplay}`,
				style: {
					text: `${cueDisplay}\nPull TRT`,
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(50, 90, 130),
				},
				feedbacks: [],
				steps: [
					{
						down: [
							{
								actionId: 'mitti_pull_trt',
								options: {
									itemId: String(item.id),
									cueNumber: 1,
									restoreCueNumber: 0,
									sampleMs: 600,
									durationSeconds: 0,
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
			presets[`arm_sub_${item.id}`] = {
				type: 'button',
				category: 'Mitti Sub-Cues',
				name: `Arm sub — ${cueDisplay}`,
				style: {
					text: `${cueDisplay}\nArm sub`,
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(130, 70, 40),
				},
				feedbacks: [
					{
						feedbackId: 'mitti_armed',
						options: {},
						style: { bgcolor: combineRgb(160, 80, 200), color: combineRgb(255, 255, 255) },
					},
					{
						feedbackId: 'mitti_aligned',
						options: {},
						style: { bgcolor: combineRgb(0, 140, 60), color: combineRgb(255, 255, 255) },
					},
				],
				steps: [
					{
						down: [
							{
								actionId: 'arm_mitti_sub_sync',
								options: {
									itemId: String(item.id),
									cueNumber: 1,
									triggerOnArm: true,
									triggerMode: 'cue',
								},
							},
						],
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
		const event = eventId ? this.events.find((e) => String(e.id) === String(eventId)) : null
		const currentItem = this.scheduleItems.find((s) => String(s.id) === String(this.activeTimer?.item_id))
		const cueLabel = currentItem
			? this.formatCueDisplay(currentItem.customFields?.cue ?? this.activeTimer?.cue_is, currentItem.id)
			: this.activeTimer?.cue_is ?? '—'

		const phase = this.mittiArm?.phase ?? 'off'
		const statusMap = {
			off: 'Off',
			idle: 'Armed — waiting for playback',
			sampling: 'Receiving OSC — locking…',
			aligned: 'Locked to Mitti',
		}
		const drift = this.getEstimatedDriftSeconds()

		this.setVariableValues({
			mitti_armed: this.mittiArm ? 'Yes' : 'No',
			mitti_sync_status: this.mittiArm ? statusMap[phase] || phase : 'Off',
			mitti_cue_number: this.mittiArm ? String(this.mittiArm.cueNumber) : '—',
			mitti_inferred_duration: this.lastInferredDuration != null ? String(this.lastInferredDuration) : '—',
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

runEntrypoint(RunOfShowMittiInstance, UpgradeScripts)
