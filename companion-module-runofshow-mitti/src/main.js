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
	addressEndsWith,
	parseTimecodeToSeconds,
	extractOscArgValue,
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
		/** Count of OSC messages seen since listener opened (debug). */
		this.oscGlobalMsgCount = 0
		this.lastDriftAlignMs = 0
		this.mittiTransportPlaying = null
		this.mittiTransportElapsed = null
		this.mittiElapsedStall = false
		this.watchConsumeInFlight = false
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
		// Never let init throw — Companion treats that as "Restart forced" crash-loop.
		try {
			this.config = config || {}
			this.updateStatus(InstanceStatus.Connecting)
			try {
				if (isFirstInit) {
					this.ensureOscListener()
				} else {
					this.closeOscListener()
					this.ensureOscListener()
				}
			} catch (oscErr) {
				this.log('warn', `OSC listener setup failed: ${oscErr.message}`)
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

			const eventId = this.normalizeEventId(this.config?.eventId)
			const mainCount = this.getRegularCues().length
			if (!eventId) {
				this.updateStatus(InstanceStatus.BadConfig, 'Set Event ID')
			} else if (mainCount === 0) {
				this.updateStatus(
					InstanceStatus.BadConfig,
					`No main cues for day ${this.config?.day || 1} — check Event ID / Day / API (see log)`
				)
			} else {
				this.updateStatus(InstanceStatus.Ok, `${mainCount} main cue(s)`)
			}
		} catch (err) {
			this.log('error', `applyConfig failed: ${err?.message || err}`)
			try {
				this.updateStatus(InstanceStatus.ConnectionFailure, err?.message || 'Init failed')
			} catch (_) {}
		}
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
				headers: {
					'Content-Type': 'application/json',
					...this.getAuthHeaders(),
					...options.headers,
				},
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

	async apiPatch(path, body) {
		return this.fetch(path, { method: 'PATCH', body: JSON.stringify(body) })
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
		try {
			const data = await this.fetch('/api/calendar-events')
			this.events = Array.isArray(data) ? data : []
		} catch (err) {
			// calendar-events often requires auth; do not block cue loading
			this.events = []
			this.log('warn', `Event list unavailable (${err.message}) — continuing with Event ID only`)
		}
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

	normalizeEventId(raw) {
		let id = String(raw || '').trim()
		if (!id) return ''
		// Allow pasting a full ROS URL with ?eventId=...
		try {
			if (id.includes('eventId=')) {
				const u = new URL(id.startsWith('http') ? id : `https://local.invalid/${id}`)
				const fromQuery = u.searchParams.get('eventId')
				if (fromQuery) id = fromQuery.trim()
			}
		} catch {
			/* keep trimmed id */
		}
		return id
	}

	async fetchRunOfShow(eventId, day = 1) {
		const data = await this.fetch(`/api/run-of-show-data/${eventId}`)
		if (!data || !data.schedule_items) {
			this.scheduleItems = []
			this.indentedCueIds = new Set()
			this.log('warn', `No schedule_items for event ${eventId} (API returned empty)`)
			return []
		}
		let items = typeof data.schedule_items === 'string' ? JSON.parse(data.schedule_items) : data.schedule_items
		if (!Array.isArray(items)) items = []
		const dayNum = parseInt(day, 10) || 1
		const indentedIds = await this.fetchIndentedCueIds(eventId)
		this.indentedCueIds = indentedIds
		const allCount = items.length
		this.scheduleItems = items
			.filter((item) => Number(item.day || 1) === dayNum)
			.map((item) => ({
				...item,
				isIndented: !!(item.isIndented || indentedIds.has(String(item.id))),
			}))
		const mainCount = this.getRegularCues().length
		const subCount = this.getSubCues().length
		this.log(
			'info',
			`Loaded schedule: ${allCount} total row(s), ${this.scheduleItems.length} for day ${dayNum} (${mainCount} main, ${subCount} sub)`
		)
		if (allCount > 0 && this.scheduleItems.length === 0) {
			const days = [...new Set(items.map((i) => Number(i.day || 1)))].sort((a, b) => a - b)
			this.log(
				'warn',
				`Day ${dayNum} has 0 cues. This event has days: ${days.join(', ')}. Change Day in module config.`
			)
		}
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
		const eventId = this.normalizeEventId(this.config?.eventId)
		if (this.config && eventId && eventId !== this.config.eventId) {
			this.config.eventId = eventId
		}
		if (!eventId) {
			this.events = []
			this.scheduleItems = []
			this.indentedCueIds = new Set()
			this.activeTimer = null
			this.log('warn', 'Event ID is empty — set Event ID in module config to load cues')
			return
		}
		this.log('info', `Fetching Run of Show for event ${eventId} (day ${this.config?.day || 1}) from ${this.getApiUrl()}`)
		// Soft-fail: must not block schedule load if calendar-events returns 401
		await this.fetchEvents()
		await this.fetchRunOfShow(eventId, this.config?.day || 1)
		try {
			await this.fetchActiveTimer(eventId)
		} catch (err) {
			this.activeTimer = null
			this.log('warn', `Active timer unavailable (${err.message})`)
		}
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
		const watchNextPlay = options.watchNextPlay === true
		const triggerOnArm = watchNextPlay ? false : options.triggerOnArm === true
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
			if (watchNextPlay) {
				try {
					await this.fetchActiveTimer(eventId)
				} catch (_) {}
			}
			const alreadyLoaded =
				watchNextPlay &&
				this.activeTimer?.item_id != null &&
				String(this.activeTimer.item_id) === String(loadItemId) &&
				this.activeTimer?.is_running !== true &&
				this.activeTimer?.timer_state !== 'running'
			if (alreadyLoaded) {
				this.log('info', `Watch: ROS cue ${loadItemId} already loaded — not reloading`)
			} else {
				await this.loadCueForMitti(eventId, loadItemId, { forSubCueParent: !!requireSubCue })
			}
			this.setMittiArm({
				itemId: String(armTrackItemId),
				cueNumber,
				isSubCue: !!requireSubCue,
				watchNextPlay,
			})
			await this.notifyMittiArm(armTrackItemId, { isSubCue: requireSubCue })
			if (watchNextPlay) {
				await this.markMittiWatchCue(armTrackItemId, true)
			}
			if (triggerOnArm) {
				this.sendMittiTrigger({ triggerMode, cueNumber })
			}
			this.ensureOscListener()
			// Ask Mitti to dump current feedback so we don't wait for the next tick
			this.requestOscFeedbackResend()
			setTimeout(() => this.requestOscFeedbackResend(), 250)
			this.updateVariableValues()
			this.checkFeedbacks('mitti_armed')
			const cueDisplay = this.formatCueDisplay(item?.customFields?.cue, itemId)
			this.log(
				'info',
				watchNextPlay
					? `Mitti watch armed for ${requireSubCue ? 'sub-cue' : 'cue'} ${cueDisplay}. ` +
						`ROS stays loaded until Mitti starts playing (switcher cut). Not sending play. ` +
						`Listening UDP ${this.getOscListenPort()}`
					: `Mitti sync armed for ${requireSubCue ? 'sub-cue' : 'cue'} ${cueDisplay} (Mitti cue ${cueNumber}; loaded ${loadItemId}). ` +
						`Listening UDP ${this.getOscListenPort()} — enable Mitti OSC Feedback → this PC:${this.getOscListenPort()}`
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

	/** Arm whatever ROS cue is already loaded. Does not play Mitti — waits for the next play. */
	async runArmMittiWatchCurrent({ requireSubCue = false } = {}) {
		const eventId = this.config?.eventId
		if (!eventId) {
			this.log('warn', 'Watch next play: set Event ID first')
			return
		}
		try {
			await this.fetchActiveTimer(eventId)
		} catch (err) {
			this.log('warn', `Watch next play: active timer unavailable (${err.message})`)
			return
		}
		const activeId = this.activeTimer?.item_id
		if (!activeId) {
			this.log('warn', 'Watch next play: no ROS cue is loaded — load one in ROS, or use Watch next play (pick cue)')
			return
		}
		const item = this.scheduleItems.find((s) => String(s.id) === String(activeId))
		const isSub = this.isScheduleItemSubCue(item)
		if (requireSubCue && !isSub) {
			this.log('warn', 'Watch next play (sub-cue): the loaded row is not a sub-cue')
			return
		}
		if (!requireSubCue && isSub) {
			this.log('warn', 'Watch next play: loaded row is a sub-cue — use the sub-cue watch action')
			return
		}
		await this.runArmMittiSync(
			{
				itemId: String(activeId),
				cueNumber: this.lastKnownMittiCueNumber || 1,
				triggerOnArm: false,
				watchNextPlay: true,
			},
			{ requireSubCue: isSub }
		)
	}

	setMittiArm({ itemId, cueNumber, isSubCue = false, watchNextPlay = false }) {
		const scheduleDurationSeconds = this.getScheduleDurationSeconds(itemId)
		const parsedCue = parseInt(cueNumber, 10)
		this.mittiArm = {
			itemId: String(itemId),
			isSubCue: !!isSubCue,
			cueNumber: watchNextPlay
				? Number.isFinite(parsedCue) && parsedCue > 0
					? parsedCue
					: this.lastKnownMittiCueNumber || 0
				: Math.max(1, parsedCue || 1),
			watchNextPlay: !!watchNextPlay,
			sawPlayEdge: false,
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
			try {
				await this.apiPost('/api/timers/mitti-disarm', { event_id: eventId })
			} catch (err) {
				this.log('error', `Mitti disarm failed: ${err.message}`)
			}
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
		const value = extractOscArgValue(oscMsg)
		const fps = this.getTimecodeFps()

		this.oscGlobalMsgCount = (this.oscGlobalMsgCount || 0) + 1
		if (this.oscGlobalMsgCount <= 12) {
			this.log('info', `OSC rx #${this.oscGlobalMsgCount}: ${address} = ${JSON.stringify(value)}`)
		}
		this.noteMittiTransport(address, value, fps)

		// Track current cue number from select-style feedback paths like /mitti/3/...
		const cuePathMatch = String(address || '').match(/^\/mitti\/(\d+)\//i)
		if (cuePathMatch) {
			this.lastKnownMittiCueNumber = parseInt(cuePathMatch[1], 10)
		}

		const durSample = this.durationSampleRequest
		if (durSample && addressEndsWith(address, FEEDBACK.CURRENT_CUE_TRT)) {
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
		if (arm.oscMsgCount <= 12) {
			this.log('info', `Armed OSC #${arm.oscMsgCount}: ${address} = ${JSON.stringify(value)}`)
		}

		if (addressEndsWith(address, FEEDBACK.TOGGLE_PLAY) || matchesAddress(address, '/mitti/playStatus')) {
			const playing =
				Number(value) >= 1 ||
				String(value).toLowerCase() === 'playing' ||
				String(value).toLowerCase() === 'true'
			const rising = playing && !arm.isPlaying
			arm.isPlaying = playing
			if (rising && arm.phase !== 'aligned') {
				this.markMittiPlayStarted(arm)
			}
		}

		if (addressEndsWith(address, FEEDBACK.CURRENT_CUE_TRT)) {
			const trt = parseTimecodeToSeconds(value, fps)
			if (trt != null && trt > 0) {
				arm.inferredDuration = trt
				this.lastInferredDuration = trt
			}
		}

		if (addressEndsWith(address, FEEDBACK.CUE_TIME_ELAPSED)) {
			const elapsed = parseTimecodeToSeconds(value, fps)
			if (elapsed != null) {
				// Watch mode: a parked/cued clip still reports time left. Only advancing
				// elapsed means Mitti actually started (switcher cut / play).
				if (
					arm.watchNextPlay &&
					arm.phase === 'idle' &&
					arm.lastElapsed != null &&
					elapsed > arm.lastElapsed + 0.04
				) {
					arm.isPlaying = true
					this.markMittiPlayStarted(arm)
				}
				arm.lastElapsed = elapsed
			}
		}

		if (!addressEndsWith(address, FEEDBACK.CUE_TIME_LEFT)) return

		const rem = parseTimecodeToSeconds(value, fps)
		if (rem == null) {
			if ((arm.oscMsgCount || 0) <= 12) {
				this.log('warn', `cueTimeLeft unparsed: ${JSON.stringify(value)}`)
			}
			return
		}
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
				return
			}
			// Drift correction between periodic aligns (throttled)
			if (!this.alignInFlight && arm.inferredDuration) {
				const rosRem = this.getRosRemainingSeconds()
				const now = Date.now()
				if (
					rosRem != null &&
					Math.abs(rosRem - rem) >= 0.75 &&
					now - (this.lastDriftAlignMs || 0) >= 1000
				) {
					this.lastDriftAlignMs = now
					this.triggerMittiAlign(arm.inferredDuration, rem, now, true, 'drift').catch((err) => {
						this.log('warn', `Drift align failed: ${err.message}`)
					})
				}
			}
			return
		}

		if (this.alignInFlight) return

		if (arm.watchNextPlay) {
			if (arm.phase === 'idle' && arm.sawPlayEdge) {
				arm.phase = 'sampling'
				arm.sampleStartMs = arm.sampleStartMs || Date.now()
			}
		} else if (arm.phase === 'idle' && (arm.isPlaying || rem > 0)) {
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
					`No align yet — enable Mitti OSC Feedback → this PC port ${this.getOscListenPort()}. ` +
						`If Companion log shows no "OSC rx" lines while Mitti plays, feedback is not reaching this module.`
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

	noteMittiTransport(address, value, fps) {
		if (this.config?.followWatchColumn === false) return
		if (addressEndsWith(address, FEEDBACK.TOGGLE_PLAY) || matchesAddress(address, '/mitti/playStatus')) {
			const playing =
				Number(value) >= 1 ||
				String(value).toLowerCase() === 'playing' ||
				String(value).toLowerCase() === 'true'
			const rising = playing && this.mittiTransportPlaying !== true
			this.mittiTransportPlaying = playing
			if (!playing) this.mittiElapsedStall = true
			if (rising) this.maybeConsumeWatchColumn('play')
			return
		}
		if (!addressEndsWith(address, FEEDBACK.CUE_TIME_ELAPSED)) return
		const elapsed = parseTimecodeToSeconds(value, fps)
		if (elapsed == null) return
		const prev = this.mittiTransportElapsed
		if (prev != null && elapsed <= prev + 0.02) {
			this.mittiElapsedStall = true
		} else if (this.mittiElapsedStall && prev != null && elapsed > prev + 0.04) {
			this.mittiElapsedStall = false
			this.mittiTransportPlaying = true
			this.maybeConsumeWatchColumn('elapsed')
		}
		this.mittiTransportElapsed = elapsed
	}

	maybeConsumeWatchColumn(reason) {
		if (this.config?.followWatchColumn === false) return
		if (this.mittiArm || this.watchConsumeInFlight) return
		this.consumeMittiWatchColumn(reason).catch((err) => {
			this.log('error', `Mitti next-cue failed: ${err.message}`)
		})
	}

	/** Next Mitti play uses the single checked rundown row. Does not replace Arm+Play. */
	async consumeMittiWatchColumn(reason) {
		if (this.mittiArm || this.watchConsumeInFlight) return
		const eventId = this.normalizeEventId(this.config?.eventId)
		if (!eventId) return
		this.watchConsumeInFlight = true
		try {
			await this.fetchData()
			const item = (this.scheduleItems || []).find(
				(row) => row?.mittiWatch === true || row?.mitti_watch === true
			)
			if (!item) {
				this.log('info', `Mitti started (${reason}) — no rundown row is checked as next`)
				return
			}
			const isSub = this.isScheduleItemSubCue(item)
			this.log(
				'info',
				`Mitti started (${reason}) — using checked row ${this.formatCueDisplay(item.customFields?.cue, item.id)}`
			)
			await this.runArmMittiSync(
				{
					itemId: String(item.id),
					cueNumber: this.lastKnownMittiCueNumber || 1,
					triggerOnArm: false,
					watchNextPlay: false,
				},
				{ requireSubCue: isSub }
			)
			await this.apiPatch(`/api/run-of-show-data/${eventId}/mitti-watch`, {
				item_id: parseInt(item.id, 10),
				enabled: false,
			})
			this.log('info', 'Cleared Mitti next-cue check so the following play waits for a new row')
		} finally {
			this.watchConsumeInFlight = false
		}
	}

	async clearMittiWatchCues() {
		const eventId = this.normalizeEventId(this.config?.eventId)
		if (!eventId) {
			this.log('warn', 'Mitti next cue: Event ID is required')
			return
		}
		await this.apiPatch(`/api/run-of-show-data/${eventId}/mitti-watch`, {
			clear_all: true,
			enabled: false,
		})
		await this.fetchData()
		this.log('info', 'Cleared every Mitti next-cue check')
	}

	async markMittiWatchCue(itemId, enabled) {
		const eventId = this.normalizeEventId(this.config?.eventId)
		if (!eventId || !itemId) {
			this.log('warn', 'Mitti next cue: Event ID and cue are required')
			return
		}
		await this.apiPatch(`/api/run-of-show-data/${eventId}/mitti-watch`, {
			item_id: parseInt(itemId, 10),
			enabled: enabled !== false,
		})
		await this.fetchData()
		const item = (this.scheduleItems || []).find((row) => String(row.id) === String(itemId))
		const label = this.formatCueDisplay(item?.customFields?.cue, itemId)
		this.log(
			'info',
			enabled === false
				? `Cleared Mitti next cue (${label})`
				: `Mitti next cue is ${label}. The next Mitti play will load and sync that row.`
		)
	}

	markMittiPlayStarted(arm) {
		if (!arm || arm.phase === 'aligned') return
		arm.sawPlayEdge = true
		arm.phase = 'sampling'
		arm.sampleStartMs = Date.now()
		arm.endTriggered = false
		if (!arm.playEdgeLogged) {
			arm.playEdgeLogged = true
			this.log('info', 'Mitti playback started — locking ROS timer to this cue')
		}
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
				type: 'textinput',
				id: 'apiToken',
				label: 'API Token (optional)',
				width: 12,
				default: '',
				tooltip:
					'Same Bearer token as the main Run of Show Companion module. Needed for indented-cues / active-timers / calendar-events when API auth is on. Cue list itself can load without it.',
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
				tooltip:
					'UUID from the ROS URL (?eventId=...). Save this connection after pasting. A full URL with eventId= also works.',
			},
			{
				type: 'number',
				id: 'day',
				label: 'Day',
				width: 4,
				default: 1,
				min: 1,
				max: 10,
				tooltip: 'Must match the Run of Show day tab (e.g. 3 for Day 3). Wrong day = empty cue dropdown.',
			},
			{
				type: 'checkbox',
				id: 'followWatchColumn',
				label: 'Follow rundown Mitti column',
				width: 12,
				default: true,
				tooltip:
					'When Mitti next starts playing, load and sync the single ROS row checked in the Mitti column. Turn off to use only the Arm buttons.',
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
			watch_next_play: {
				type: 'button',
				category: 'Mitti',
				name: 'Watch next Mitti play (loaded ROS cue)',
				style: {
					text: 'Watch\nNext Play',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(90, 50, 160),
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
						down: [{ actionId: 'arm_mitti_watch_current', options: {} }],
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
			idle: this.mittiArm?.watchNextPlay
				? 'Watching — waiting for Mitti play'
				: 'Armed — waiting for playback',
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
