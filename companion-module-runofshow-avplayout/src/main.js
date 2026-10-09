const { InstanceBase, runEntrypoint, InstanceStatus, combineRgb } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')
const avClient = require('./avPlayoutClient')

function getWebSocketImpl() {
	if (typeof WebSocket !== 'undefined') return WebSocket
	if (globalThis.WebSocket) return globalThis.WebSocket
	try {
		return require('ws')
	} catch {
		return null
	}
}

/**
 * AV-Playout Sync — parallel option to Resolume / Mitti Sync.
 *
 * Live timer: AV-Playout WebSocket telemetry (position/duration) → one-shot avplayout-sync-align.
 * Fire: HTTP POST /api/transport/play { index } on the local AV-Playout server.
 */
class RunOfShowAvPlayoutInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.events = []
		this.scheduleItems = []
		this.indentedCueIds = new Set()
		this.activeTimer = null
		this.avArm = null
		this.ws = null
		this.reconnectTimer = null
		this.avConnected = false
		this.avPhase = 'idle'
		this.avPosition = 0
		this.avDuration = 0
		this.lastInferredDuration = null
		this.alignInFlight = false
		this.periodicAlignInterval = null
		this.lastSyncAt = null
		this.lastSyncReason = ''
		this.lastSyncRemaining = null
		this.syncCount = 0
		this.syncPulseActive = false
		this.syncPulseTimeout = null
		this.lastDriftAlignMs = 0
		this.telMsgCount = 0
		this.pendingCueEndTimer = null
		this.avWasPlaying = null
		this.avLastPos = null
		this.avPosStall = false
		this.watchConsumeInFlight = false
	}

	async init(config) {
		await this.applyConfig(config, true)
	}

	async destroy() {
		this.stopPeriodicAlign()
		this.clearPendingCueEnd()
		if (this.syncPulseTimeout) clearTimeout(this.syncPulseTimeout)
		this.clearReconnect()
		this.closeWs()
		this.avArm = null
	}

	clearPendingCueEnd() {
		if (this.pendingCueEndTimer) {
			clearTimeout(this.pendingCueEndTimer)
			this.pendingCueEndTimer = null
		}
	}

	async configUpdated(config) {
		await this.applyConfig(config, false)
	}

	async applyConfig(config, isFirstInit) {
		try {
			this.config = config || {}
			this.updateStatus(InstanceStatus.Connecting)

			try {
				this.clearReconnect()
				this.closeWs()
				await this.connectAvPlayout()
			} catch (err) {
				this.log('warn', `AV-Playout connect failed: ${err.message}`)
			}

			try {
				await this.fetchData()
			} catch (err) {
				this.log(
					'warn',
					`API fetch failed (${err.message}). Check API URL + Event ID. AV-Playout WS may still be active.`
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
			if (!this.avConnected && !eventId) {
				this.updateStatus(InstanceStatus.BadConfig, 'Connect AV-Playout host/port (Event ID optional for direct control)')
			} else if (!this.avConnected) {
				this.updateStatus(
					InstanceStatus.Connecting,
					eventId ? `${mainCount} cues — connecting AV-Playout…` : 'Connecting AV-Playout…'
				)
			} else if (!eventId) {
				this.updateStatus(InstanceStatus.Ok, 'AV-Playout OK · direct transport (no Event ID)')
			} else if (mainCount === 0) {
				this.updateStatus(
					InstanceStatus.Ok,
					`AV-Playout OK · no ROS cues for day ${this.config?.day || 1} (direct transport still works)`
				)
			} else {
				this.updateStatus(InstanceStatus.Ok, `${mainCount} main cue(s) · AV-Playout OK`)
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

	getAvBaseUrl() {
		const host = String(this.config?.avHost || '127.0.0.1').trim() || '127.0.0.1'
		const port = String(this.config?.avPort || '8080').trim() || '8080'
		return `http://${host}:${port}`
	}

	getAvWsUrl() {
		const host = String(this.config?.avHost || '127.0.0.1').trim() || '127.0.0.1'
		const port = String(this.config?.avPort || '8080').trim() || '8080'
		return `ws://${host}:${port}/ws`
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
		return Number.isFinite(ms) && ms >= 0 ? Math.min(15000, ms) : 400
	}

	getPeriodicAlignIntervalSeconds() {
		const s = parseInt(this.config?.periodicAlignIntervalSeconds, 10)
		return Number.isFinite(s) && s >= 0 ? s : 10
	}

	/** When clearing ROS sync / stopping timer, also stop Caspar via AV-Playout. */
	getStopAvOnClear() {
		return this.config?.stopAvOnClear !== false
	}

	getClearAvLayerOnStop() {
		return this.config?.clearAvLayerOnStop === true
	}

	async stopAvPlayback({ reason = 'stop' } = {}) {
		const base = this.getAvBaseUrl()
		try {
			await avClient.stop(base, {})
			if (this.getClearAvLayerOnStop()) {
				await avClient.clear(base, {})
			}
			this.log('info', `Stopped AV-Playout / Caspar (${reason})`)
		} catch (err) {
			this.log('warn', `AV-Playout stop failed (${reason}): ${err.message}`)
		}
	}

	/** Play/Fire current AV cue, or a 1-based index when provided. */
	async playAvDirect({ cueIndex } = {}) {
		const base = this.getAvBaseUrl()
		const index = parseInt(cueIndex, 10)
		const body = Number.isFinite(index) && index >= 1 ? { index } : {}
		await avClient.play(base, body)
		this.log('info', body.index ? `Play/Fire AV cue index ${body.index}` : 'Play/Fire AV current cue')
	}

	async pauseAvDirect() {
		await avClient.pause(this.getAvBaseUrl())
		this.log('info', 'Paused AV-Playout / Caspar')
	}

	async resumeAvDirect() {
		await avClient.resume(this.getAvBaseUrl())
		this.log('info', 'Resumed AV-Playout / Caspar')
	}

	async loadAvDirect({ cueIndex } = {}) {
		const base = this.getAvBaseUrl()
		const index = parseInt(cueIndex, 10)
		const body = Number.isFinite(index) && index >= 1 ? { index } : {}
		await avClient.load(base, body)
		this.log('info', body.index ? `Loaded AV cue index ${body.index}` : 'Loaded AV current cue')
	}

	/**
	 * Arm without picking a ROS cue/layer:
	 * - If Event ID + a loaded ROS cue exists → full sync arm on that cue
	 * - Else → AV-only arm (listen / optional fire) for standalone use
	 */
	async runArmAvPlayoutCurrent(options = {}) {
		const eventId = this.normalizeEventId(this.config?.eventId)
		const cueIndexRaw = parseInt(options.cueIndex, 10)
		const cueIndex = Number.isFinite(cueIndexRaw) && cueIndexRaw >= 1 ? cueIndexRaw : 0
		const triggerOnArm = options.triggerOnArm !== false

		if (eventId) {
			try {
				await this.fetchActiveTimer(eventId)
			} catch (_) {}
			const activeId = this.activeTimer?.item_id
			if (activeId) {
				const item = this.scheduleItems.find((s) => String(s.id) === String(activeId))
				const isSub = this.isScheduleItemSubCue(item)
				await this.runArmAvPlayoutSync(
					{
						itemId: String(activeId),
						cueIndex,
						triggerOnArm,
					},
					{ requireSubCue: isSub }
				)
				return
			}
		}

		// Standalone / no loaded ROS cue — arm AV listen only
		this.setAvArm({
			itemId: 'direct',
			cueIndex: cueIndex || 1,
			isSubCue: false,
			avOnly: true,
		})
		if (triggerOnArm) {
			try {
				await this.playAvDirect({ cueIndex: cueIndex || undefined })
			} catch (fireErr) {
				this.log('warn', `AV-Playout fire failed: ${fireErr.message}`)
			}
		}
		await this.connectAvPlayout()
		this.updateVariableValues()
		this.checkFeedbacks('avplayout_armed')
		this.log(
			'info',
			`AV-Playout armed (direct / no ROS cue)${cueIndex ? ` — cue index ${cueIndex}` : ' — current cue'}`
		)
	}

	/** Push current AV remaining/duration to the armed or loaded ROS cue (no dropdown). */
	async sendAvPlayoutTime() {
		const eventId = this.normalizeEventId(this.config?.eventId)
		if (!eventId) {
			this.log('warn', 'Send Time: set Event ID to push time into ROS (direct AV transport does not need this)')
			return
		}

		try {
			const snap = await avClient.getState(this.getAvBaseUrl())
			this.applyAvSnapshot(snap)
		} catch (err) {
			this.log('warn', `Send Time: AV state refresh failed (${err.message})`)
		}

		try {
			await this.fetchActiveTimer(eventId)
		} catch (_) {}

		const armedId =
			this.avArm?.itemId && this.avArm.itemId !== 'direct' && !this.avArm.avOnly
				? this.avArm.itemId
				: null
		const itemId = armedId || this.activeTimer?.item_id
		if (!itemId) {
			this.log('warn', 'Send Time: no loaded or armed ROS cue — load a cue in ROS, or Arm with a cue first')
			return
		}

		let durationSeconds =
			this.avDuration > 1
				? Math.round(this.avDuration)
				: this.avArm?.inferredDuration > 1
					? Math.round(this.avArm.inferredDuration)
					: this.getScheduleDurationSeconds(itemId)
		let remainingSeconds =
			this.avDuration > 1
				? Math.max(0, this.avDuration - this.avPosition)
				: this.avArm?.lastRemaining

		if (!(durationSeconds > 0) || remainingSeconds == null || !Number.isFinite(remainingSeconds)) {
			this.log('warn', 'Send Time: no AV duration/position yet — play a clip first (Caspar Live lamp)')
			return
		}

		const item = this.scheduleItems.find((s) => String(s.id) === String(itemId))
		const cueIs = item?.customFields?.cue ?? this.activeTimer?.cue_is ?? `CUE ${itemId}`
		const isSubCue = this.avArm?.isSubCue === true || this.isScheduleItemSubCue(item)

		try {
			if (!this.avArm || this.avArm.avOnly || this.avArm.itemId === 'direct') {
				this.setAvArm({
					itemId: String(itemId),
					cueIndex: this.avArm?.cueIndex || 1,
					isSubCue,
					avOnly: false,
				})
				await this.notifyAvArm(itemId, { isSubCue })
			}
			await this.postAvAlign({
				eventId,
				itemId,
				cueIs,
				durationSeconds,
				remainingSeconds,
				alignAtMs: Date.now(),
				alignReason: 'manual-send',
				isSubCue,
			})
			this.recordSyncSuccess('manual-send', remainingSeconds, durationSeconds)
			this.log(
				'info',
				`Send Time: ${Math.round(remainingSeconds * 10) / 10}s left of ${durationSeconds}s → ${this.formatCueDisplay(cueIs, itemId)}`
			)
		} catch (err) {
			this.log('error', `Send Time failed: ${err.message}`)
		}
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

	/** Normalize Caspar telemetry: seconds, or frames when values look like frame counts. */
	normalizeTelSeconds(position, duration) {
		let pos = Number(position) || 0
		let dur = Number(duration) || 0
		if (dur > 1000 && pos >= 0) {
			const fps = 30
			pos = pos / fps
			dur = dur / fps
		}
		return { position: pos, duration: dur }
	}

	resolveCueDuration(arm) {
		if (arm.inferredDuration && arm.inferredDuration > 0) {
			return { duration: Math.round(arm.inferredDuration), source: 'telemetry' }
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
		if (this.avArm) {
			this.avArm.phase = 'aligned'
			this.avArm.inferredDuration = durationSeconds
		}
		this.updateVariableValues()
		this.checkFeedbacks('avplayout_armed', 'avplayout_aligned', 'avplayout_sync_pulse')
		if (this.syncPulseTimeout) clearTimeout(this.syncPulseTimeout)
		this.syncPulseActive = true
		this.checkFeedbacks('avplayout_sync_pulse')
		this.syncPulseTimeout = setTimeout(() => {
			this.syncPulseActive = false
			this.checkFeedbacks('avplayout_sync_pulse')
		}, 2000)
	}

	getEstimatedDriftSeconds() {
		const arm = this.avArm
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
				const arm = self.avArm
				if (!arm || arm.phase !== 'aligned' || !arm.inferredDuration || arm.endTriggered) return
				if (arm.lastRemaining == null) return
				const eventId = self.config?.eventId
				if (eventId) {
					try {
						await self.fetchActiveTimer(eventId)
					} catch (_) {}
				}
				const rem = arm.lastRemaining
				const nearStartAfterNearEnd =
					arm.lastRemaining > arm.inferredDuration * 0.9 &&
					self.lastSyncRemaining != null &&
					self.lastSyncRemaining <= 20
				const reason = nearStartAfterNearEnd ? 'loop' : 'periodic'
				if (nearStartAfterNearEnd) {
					self.log('info', 'Periodic: clip looped — re-aligning ROS countdown to feedback')
					arm.endTriggered = false
					self.clearPendingCueEnd()
				}
				await self.triggerAvAlign(arm.inferredDuration, rem, Date.now(), true, reason)
			}
			run().catch((err) => self.log('warn', `Periodic align failed: ${err.message}`))
		}, sec * 1000)
	}

	clearReconnect() {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
	}

	closeWs() {
		const ws = this.ws
		this.ws = null
		this.avConnected = false
		if (!ws) return
		try {
			ws.onopen = null
			ws.onclose = null
			ws.onerror = null
			ws.onmessage = null
			ws.close()
		} catch (_) {}
	}

	scheduleReconnect() {
		this.clearReconnect()
		this.reconnectTimer = setTimeout(() => {
			this.connectAvPlayout().catch(() => {})
		}, 1500)
	}

	async connectAvPlayout() {
		this.closeWs()
		const WS = getWebSocketImpl()
		if (!WS) {
			this.log('error', 'WebSocket not available in Companion runtime')
			return
		}

		try {
			const snap = await avClient.getState(this.getAvBaseUrl())
			this.applyAvSnapshot(snap)
		} catch (err) {
			this.log('warn', `AV-Playout HTTP state: ${err.message}`)
		}

		const url = this.getAvWsUrl()
		this.log('info', `Connecting AV-Playout ${url}`)
		let ws
		try {
			ws = new WS(url)
		} catch (err) {
			this.log('error', `WS open failed: ${err.message}`)
			this.scheduleReconnect()
			return
		}
		this.ws = ws

		ws.onopen = () => {
			if (this.ws !== ws) return
			this.avConnected = true
			this.log('info', 'AV-Playout WebSocket connected')
			this.updateVariableValues()
			this.checkFeedbacks('avplayout_connected')
			const n = this.getRegularCues().length
			if (this.normalizeEventId(this.config?.eventId) && n > 0) {
				this.updateStatus(InstanceStatus.Ok, `${n} main cue(s) · AV-Playout OK`)
			}
		}

		ws.onclose = () => {
			if (this.ws !== ws) return
			this.ws = null
			this.avConnected = false
			this.updateVariableValues()
			this.checkFeedbacks('avplayout_connected')
			this.scheduleReconnect()
		}

		ws.onerror = () => {}

		ws.onmessage = (ev) => {
			try {
				const raw = typeof ev.data === 'string' ? ev.data : String(ev.data || '')
				const msg = JSON.parse(raw)
				if (msg.type === 'state' && msg.payload) {
					this.applyAvSnapshot(msg.payload)
				} else if (msg.type === 'telemetry' && msg.payload) {
					this.applyAvTelemetry(msg.payload)
				}
			} catch (err) {
				this.log('debug', `WS parse: ${err.message}`)
			}
		}
	}

	applyAvTelemetry(payload) {
		const tel = payload?.telemetry || payload
		const { position, duration } = this.normalizeTelSeconds(tel?.position, tel?.duration)
		this.avPosition = position
		this.avDuration = duration
		if (payload?.playback?.phase) this.avPhase = payload.playback.phase
		this.onTelemetryTick(position, duration)
	}

	applyAvSnapshot(snap) {
		if (!snap) return
		const pb = snap.playback || {}
		this.avPhase = pb.phase || 'idle'
		const tel = snap.telemetry || {}
		const { position, duration } = this.normalizeTelSeconds(tel.position, tel.duration)
		this.avPosition = position
		this.avDuration = duration
		this.onTelemetryTick(position, duration)
		this.updateVariableValues()
	}

	onTelemetryTick(position, duration) {
		this.noteAvTransport(position, duration)
		if (!this.avArm) return
		const arm = this.avArm

		this.telMsgCount = (this.telMsgCount || 0) + 1
		if (this.telMsgCount <= 8) {
			this.log(
				'info',
				`Tel #${this.telMsgCount}: phase=${this.avPhase} pos=${position.toFixed?.(2) ?? position} dur=${duration.toFixed?.(2) ?? duration}`
			)
		}

		const playing = this.avPhase === 'playing' || (duration > 1 && position > 0.05)
		if (playing && arm.phase === 'idle') {
			arm.phase = 'sampling'
			arm.sampleStartMs = Date.now()
			arm.endTriggered = false
		}

		if (!(duration > 1) || position < 0) return

		const rem = Math.max(0, duration - position)
		arm.lastRemaining = rem
		arm.lastFeedbackMs = Date.now()
		if (duration > 1) {
			arm.inferredDuration = duration
			this.lastInferredDuration = duration
		}

		// Standalone AV arm — track telemetry only (no ROS align until Send Time / cue arm)
		if (arm.avOnly || arm.itemId === 'direct') {
			if (playing && arm.phase !== 'aligned') arm.phase = 'sampling'
			this.updateVariableValues()
			return
		}

		if (arm.phase === 'aligned') {
			const prevRem = arm.prevRemaining
			arm.prevRemaining = rem

			// Clip looped: remaining jumped from near-end back to near-full
			const looped =
				prevRem != null &&
				prevRem <= Math.max(2, this.getCueEndThresholdSeconds() + 1.5) &&
				rem > (arm.inferredDuration || duration) * 0.85
			if (looped && arm.inferredDuration && !this.alignInFlight) {
				this.clearPendingCueEnd()
				arm.endTriggered = false
				this.log('info', `Clip loop detected — rem ${prevRem?.toFixed?.(1)} → ${rem.toFixed?.(1)}s`)
				this.triggerAvAlign(arm.inferredDuration, rem, Date.now(), true, 'loop').catch((err) =>
					this.log('warn', `Loop align failed: ${err.message}`)
				)
				this.updateVariableValues()
				return
			}

			// Defer cue-end so a loop restart can cancel it (looping Caspar clips)
			if (!arm.endTriggered && rem <= this.getCueEndThresholdSeconds() && !this.pendingCueEndTimer) {
				const action = this.getCueEndAction()
				this.pendingCueEndTimer = setTimeout(() => {
					this.pendingCueEndTimer = null
					const a = this.avArm
					if (!a || a.phase !== 'aligned' || a.endTriggered) return
					// Still near end → treat as finished (non-looping clip)
					if (a.lastRemaining == null || a.lastRemaining > this.getCueEndThresholdSeconds() + 0.75) {
						return
					}
					if (action === 'align_zero') {
						this.triggerCueEndAlignZero().catch((err) =>
							this.log('error', `Cue end align failed: ${err.message}`)
						)
					} else if (action === 'stop' || action === 'none') {
						this.triggerCueEndStop().catch((err) =>
							this.log('error', `Cue end stop failed: ${err.message}`)
						)
					} else if (action === 'keep_running') {
						this.triggerCueEndRelease().catch((err) =>
							this.log('error', `Cue end release failed: ${err.message}`)
						)
					}
				}, 1200)
			}

			if (!this.alignInFlight && arm.inferredDuration) {
				const rosRem = this.getRosRemainingSeconds()
				const now = Date.now()
				if (
					rosRem != null &&
					Math.abs(rosRem - rem) >= 0.75 &&
					now - (this.lastDriftAlignMs || 0) >= 1000
				) {
					this.lastDriftAlignMs = now
					const reason =
						rosRem <= 15 && rem > arm.inferredDuration * 0.85 ? 'loop' : 'drift'
					if (reason === 'loop') {
						this.clearPendingCueEnd()
						arm.endTriggered = false
					}
					this.triggerAvAlign(arm.inferredDuration, rem, now, true, reason).catch((err) =>
						this.log('warn', `${reason} align failed: ${err.message}`)
					)
				}
			}
			this.updateVariableValues()
			return
		}

		if (this.alignInFlight) return
		if (arm.phase === 'idle' && rem > 0 && duration > 1) {
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
					`No align yet — ensure Caspar OSC telemetry is live in AV-Playout (Live lamp), and a clip is playing`
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
				`Sync using schedule duration ${resolved.duration}s (waiting for Caspar duration while playing)`
			)
		}

		const alignDur = arm.inferredDuration > 1 ? Math.round(arm.inferredDuration) : resolved.duration
		this.triggerAvAlign(alignDur, rem, Date.now(), false, 'initial').catch((err) => {
			this.log('error', `AV-Playout align failed: ${err.message}`)
			arm.phase = 'idle'
			this.alignInFlight = false
		})
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
			if (err?.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs}ms`)
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

	noteAvTransport(position, duration) {
		if (this.config?.followWatchColumn === false) return
		const pos = Number(position) || 0
		const dur = Number(duration) || 0
		const phasePlaying = this.avPhase === 'playing'
		if (this.avWasPlaying == null) {
			this.avWasPlaying = phasePlaying
			this.avLastPos = pos
			this.avPosStall = !phasePlaying
			return
		}
		const rising = phasePlaying && this.avWasPlaying !== true
		this.avWasPlaying = phasePlaying
		if (!phasePlaying) this.avPosStall = true
		if (rising) this.maybeConsumeAvWatch('play')
		const prev = this.avLastPos
		if (prev != null && Math.abs(pos - prev) < 0.02) {
			this.avPosStall = true
		} else if (this.avPosStall && prev != null && pos > prev + 0.05 && dur > 1) {
			this.avPosStall = false
			this.avWasPlaying = true
			this.maybeConsumeAvWatch('position')
		}
		this.avLastPos = pos
	}

	maybeConsumeAvWatch(reason) {
		if (this.config?.followWatchColumn === false) return
		if (this.avArm || this.watchConsumeInFlight) return
		this.consumeAvWatchColumn(reason).catch((err) => {
			this.log('error', `AV next-cue failed: ${err.message}`)
		})
	}

	/** Next AV-Playout play uses the single checked rundown row. Does not replace Arm+Play. */
	async consumeAvWatchColumn(reason) {
		if (this.avArm || this.watchConsumeInFlight) return
		const eventId = this.normalizeEventId(this.config?.eventId)
		if (!eventId) return
		this.watchConsumeInFlight = true
		try {
			await this.fetchData()
			const item = (this.scheduleItems || []).find(
				(row) => row?.avWatch === true || row?.av_watch === true
			)
			if (!item) {
				this.log('info', `AV-Playout started (${reason}) — no rundown row is checked as next`)
				return
			}
			const isSub = this.isScheduleItemSubCue(item)
			this.log(
				'info',
				`AV-Playout started (${reason}) — using checked row ${this.formatCueDisplay(item.customFields?.cue, item.id)}`
			)
			await this.runArmAvPlayoutSync(
				{
					itemId: String(item.id),
					cueIndex: 0,
					triggerOnArm: false,
				},
				{ requireSubCue: isSub }
			)
			await this.apiPatch(`/api/run-of-show-data/${eventId}/av-watch`, {
				item_id: parseInt(item.id, 10),
				enabled: false,
			})
			this.log('info', 'Cleared AV next-cue check so the following play waits for a new row')
		} finally {
			this.watchConsumeInFlight = false
		}
	}

	async clearAvWatchCues() {
		const eventId = this.normalizeEventId(this.config?.eventId)
		if (!eventId) {
			this.log('warn', 'AV next cue: Event ID is required')
			return
		}
		await this.apiPatch(`/api/run-of-show-data/${eventId}/av-watch`, {
			clear_all: true,
			enabled: false,
		})
		await this.fetchData()
		this.log('info', 'Cleared every AV next-cue check')
	}

	async markAvWatchCue(itemId, enabled) {
		const eventId = this.normalizeEventId(this.config?.eventId)
		if (!eventId || !itemId) {
			this.log('warn', 'AV next cue: Event ID and cue are required')
			return
		}
		await this.apiPatch(`/api/run-of-show-data/${eventId}/av-watch`, {
			item_id: parseInt(itemId, 10),
			enabled: enabled !== false,
		})
		await this.fetchData()
		const item = (this.scheduleItems || []).find((row) => String(row.id) === String(itemId))
		const label = this.formatCueDisplay(item?.customFields?.cue, itemId)
		this.log(
			'info',
			enabled === false
				? `Cleared AV next cue (${label})`
				: `AV next cue is ${label}. The next AV-Playout play will load and sync that row.`
		)
	}

	async apiPut(path, body) {
		return this.fetch(path, { method: 'PUT', body: JSON.stringify(body) })
	}

	async fetchEvents() {
		try {
			const data = await this.fetch('/api/calendar-events')
			this.events = Array.isArray(data) ? data : []
		} catch (err) {
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
		try {
			if (id.includes('eventId=')) {
				const u = new URL(id.startsWith('http') ? id : `https://local.invalid/${id}`)
				const fromQuery = u.searchParams.get('eventId')
				if (fromQuery) id = fromQuery.trim()
			}
		} catch {
			/* keep */
		}
		return id
	}

	async fetchRunOfShow(eventId, day = 1) {
		const data = await this.fetch(`/api/run-of-show-data/${eventId}`)
		if (!data || !data.schedule_items) {
			this.scheduleItems = []
			this.indentedCueIds = new Set()
			this.log('warn', `No schedule_items for event ${eventId}`)
			return []
		}
		let items = typeof data.schedule_items === 'string' ? JSON.parse(data.schedule_items) : data.schedule_items
		if (!Array.isArray(items)) items = []
		const dayNum = parseInt(day, 10) || 1
		const indentedIds = await this.fetchIndentedCueIds(eventId)
		this.indentedCueIds = indentedIds
		this.scheduleItems = items
			.filter((item) => Number(item.day || 1) === dayNum)
			.map((item) => ({
				...item,
				isIndented: !!(item.isIndented || indentedIds.has(String(item.id))),
			}))
		this.log(
			'info',
			`Loaded schedule: ${this.scheduleItems.length} for day ${dayNum} (${this.getRegularCues().length} main)`
		)
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
			this.log('warn', 'Event ID is empty')
			return
		}
		this.log('info', `Fetching ROS event ${eventId} day ${this.config?.day || 1}`)
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

	async fireAvPlayoutCue(cueIndex) {
		const index = parseInt(cueIndex, 10)
		if (Number.isFinite(index) && index >= 1) {
			await avClient.play(this.getAvBaseUrl(), { index })
			this.log('info', `Fired AV-Playout cue index ${index}`)
			return
		}
		await avClient.play(this.getAvBaseUrl(), {})
		this.log('info', 'Fired AV-Playout current cue')
	}

	async runArmAvPlayoutSync(options, { requireSubCue }) {
		const eventId = this.config?.eventId
		const itemId = options.itemId
		const cueIndexRaw = parseInt(options.cueIndex, 10)
		const cueIndex = Number.isFinite(cueIndexRaw) && cueIndexRaw >= 1 ? cueIndexRaw : 0
		const triggerOnArm = options.triggerOnArm === true
		if (!eventId || !itemId) {
			this.log('warn', 'Arm AV-Playout: Event ID and cue are required')
			return
		}
		const item = this.scheduleItems.find((s) => String(s.id) === String(itemId))
		const isSub = this.isScheduleItemSubCue(item)
		if (requireSubCue && !isSub) {
			this.log('warn', 'Arm sub-cue: select an indented sub-cue row')
			return
		}
		if (!requireSubCue && isSub) {
			this.log('warn', 'Arm AV-Playout: use a main cue row, not a sub-cue')
			return
		}
		let loadItemId = itemId
		let armTrackItemId = itemId
		if (requireSubCue) {
			const parentId = this.findParentCueId(itemId)
			if (parentId == null) {
				this.log('warn', 'Arm sub-cue: could not find parent row')
				return
			}
			loadItemId = parentId
			armTrackItemId = itemId
		}
		try {
			await this.loadCueForAv(eventId, loadItemId, { forSubCueParent: !!requireSubCue })
			this.setAvArm({
				itemId: String(armTrackItemId),
				cueIndex: cueIndex || 1,
				isSubCue: !!requireSubCue,
			})
			await this.notifyAvArm(armTrackItemId, { isSubCue: requireSubCue })
			if (triggerOnArm) {
				try {
					await this.fireAvPlayoutCue(cueIndex)
				} catch (fireErr) {
					this.log('warn', `AV-Playout fire failed: ${fireErr.message}`)
				}
			}
			await this.connectAvPlayout()
			this.updateVariableValues()
			this.checkFeedbacks('avplayout_armed')
			const cueDisplay = this.formatCueDisplay(item?.customFields?.cue, itemId)
			this.log(
				'info',
				`AV-Playout sync armed for ${requireSubCue ? 'sub-cue' : 'cue'} ${cueDisplay} (AV ${cueIndex ? `cue ${cueIndex}` : 'current'})`
			)
		} catch (err) {
			this.log('error', `Arm AV-Playout failed: ${err.message}`)
		}
	}

	async loadCueForAv(eventId, itemId, { forSubCueParent = false } = {}) {
		await this.fetchActiveTimer(eventId)
		await this.stopAllSubCueTimers(eventId)

		const targetId = String(itemId)
		const activeId = this.activeTimer?.item_id != null ? String(this.activeTimer.item_id) : null
		const activeRunning =
			this.activeTimer?.is_running === true || this.activeTimer?.timer_state === 'running'

		if (forSubCueParent && activeId === targetId) {
			this.log(
				'info',
				`Sub-cue arm: parent cue ${itemId} left ${activeRunning ? 'RUNNING' : 'LOADED'}`
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
			user_id: 'companion-avplayout',
			cue_is: cueIs,
			duration_seconds: dur ?? 300,
		})
		await this.fetchActiveTimer(eventId)
		this.updateVariableValues()
	}

	async notifyAvArm(itemId, { isSubCue = false } = {}) {
		const eventId = this.config?.eventId
		if (!eventId || !itemId) return
		try {
			await this.apiPost('/api/timers/avplayout-arm', {
				event_id: eventId,
				item_id: parseInt(itemId, 10),
				is_sub_cue: !!isSubCue,
			})
		} catch (err) {
			this.log('warn', `avplayout-arm notify failed: ${err.message}`)
		}
	}

	setAvArm({ itemId, cueIndex, isSubCue = false, avOnly = false }) {
		const scheduleDurationSeconds = avOnly ? null : this.getScheduleDurationSeconds(itemId)
		this.avArm = {
			itemId: String(itemId),
			isSubCue: !!isSubCue,
			avOnly: !!avOnly,
			cueIndex: Math.max(1, parseInt(cueIndex, 10) || 1),
			phase: 'idle',
			sampleStartMs: 0,
			scheduleDurationSeconds,
			inferredDuration: null,
			lastRemaining: null,
			prevRemaining: null,
			lastFeedbackMs: 0,
			endTriggered: false,
			followUpScheduled: false,
			usedScheduleFallback: false,
		}
		this.alignInFlight = false
		this.telMsgCount = 0
		this.clearPendingCueEnd()
		this.log(
			'info',
			`Watching AV-Playout telemetry (cue ${cueIndex}; schedule ${scheduleDurationSeconds ?? 'unknown'}s)`
		)
	}

	async clearAvArm({ stopPlayback = true } = {}) {
		this.stopPeriodicAlign()
		this.clearPendingCueEnd()
		const eventId = this.config?.eventId
		const shouldStop = stopPlayback && this.getStopAvOnClear()
		this.avArm = null
		this.alignInFlight = false
		if (shouldStop) {
			await this.stopAvPlayback({ reason: 'clear-sync' })
		}
		if (eventId) {
			try {
				await this.apiPost('/api/timers/avplayout-disarm', { event_id: eventId })
			} catch (err) {
				this.log('error', `AV-Playout disarm failed: ${err.message}`)
			}
		}
		this.updateVariableValues()
		this.checkFeedbacks('avplayout_armed', 'avplayout_aligned')
	}

	scheduleFollowUpAlign() {
		const arm = this.avArm
		const delayMs = this.getFollowUpAlignMs()
		if (!arm || delayMs <= 0 || arm.followUpScheduled) return
		arm.followUpScheduled = true
		const self = this
		setTimeout(() => {
			const a = self.avArm
			if (!a || a.phase !== 'aligned' || !a.inferredDuration || a.lastRemaining == null) return
			self.triggerAvAlign(a.inferredDuration, a.lastRemaining, a.lastFeedbackMs, true, 'follow-up').catch(
				(err) => self.log('warn', `Follow-up align failed: ${err.message}`)
			)
		}, delayMs)
	}

	async stopSubCueAtEnd(eventId, itemId) {
		await this.apiPut('/api/sub-cue-timers/stop', {
			event_id: eventId,
			item_id: parseInt(itemId, 10),
		})
	}

	async triggerCueEndAlignZero() {
		const arm = this.avArm
		const eventId = this.config?.eventId
		if (!arm || arm.endTriggered || !eventId || !arm.inferredDuration) return
		arm.endTriggered = true
		const dur = arm.inferredDuration
		const itemId = parseInt(arm.itemId, 10)
		try {
			if (arm.isSubCue) {
				await this.triggerAvAlign(dur, 0, arm.lastFeedbackMs || Date.now(), true, 'cue-end')
				await this.stopSubCueAtEnd(eventId, itemId)
				await this.apiPost('/api/timers/avplayout-end', { event_id: eventId })
				await this.clearAvArm({ stopPlayback: true })
				return
			}
			await this.triggerAvAlign(dur, 0, arm.lastFeedbackMs || Date.now(), true, 'cue-end')
			await this.apiPost('/api/timers/avplayout-end', { event_id: eventId })
			await this.clearAvArm({ stopPlayback: true })
			await this.fetchActiveTimer(eventId)
			this.log('info', 'Cue ended — timer synced to 0 (+ AV-Playout stopped if enabled)')
		} catch (err) {
			arm.endTriggered = false
			throw err
		}
	}

	async triggerCueEndStop() {
		const arm = this.avArm
		const eventId = this.config?.eventId
		if (!arm || arm.endTriggered || !eventId) return
		arm.endTriggered = true
		const itemId = parseInt(arm.itemId, 10)
		try {
			if (arm.isSubCue) {
				await this.stopSubCueAtEnd(eventId, itemId)
			} else {
				await this.apiPost('/api/timers/stop', { event_id: eventId, item_id: itemId })
			}
			await this.apiPost('/api/timers/avplayout-end', { event_id: eventId })
			// clearAvArm stops AV-Playout when stopAvOnClear is enabled
			await this.clearAvArm({ stopPlayback: true })
			await this.fetchActiveTimer(eventId)
		} catch (err) {
			arm.endTriggered = false
			throw err
		}
	}

	async triggerCueEndRelease() {
		const arm = this.avArm
		const eventId = this.config?.eventId
		if (!arm || arm.endTriggered || !eventId) return
		arm.endTriggered = true
		try {
			if (arm.isSubCue) await this.stopSubCueAtEnd(eventId, parseInt(arm.itemId, 10))
			await this.apiPost('/api/timers/avplayout-end', { event_id: eventId })
			// Release ROS lock only — leave Caspar playing
			this.stopPeriodicAlign()
			this.clearPendingCueEnd()
			this.avArm = null
			this.alignInFlight = false
			this.updateVariableValues()
			this.checkFeedbacks('avplayout_armed', 'avplayout_aligned')
			await this.fetchActiveTimer(eventId)
		} catch (err) {
			arm.endTriggered = false
			throw err
		}
	}

	async triggerAvAlign(durationSeconds, remainingSeconds, alignAtMs, isFollowUp = false, reason = 'align') {
		if (this.alignInFlight || !this.avArm) return
		if (this.avArm.avOnly || this.avArm.itemId === 'direct') return
		this.alignInFlight = true
		const eventId = this.config?.eventId
		const itemId = this.avArm.itemId
		const item = this.scheduleItems.find((s) => String(s.id) === String(itemId))
		const cueIs = item?.customFields?.cue ?? `CUE ${itemId}`
		const isSubCue = this.avArm?.isSubCue === true || this.isScheduleItemSubCue(item)

		try {
			await this.postAvAlign({
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
				`[${reason}] SYNC #${this.syncCount} — ${Math.round(remainingSeconds * 10) / 10}s left (dur ${durationSeconds}s)${drift != null ? `, drift ${drift}s` : ''}`
			)
			if (!isFollowUp) {
				this.scheduleFollowUpAlign()
				this.startPeriodicAlign()
			}
		} finally {
			this.alignInFlight = false
		}
	}

	async postAvAlign({
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
		await this.apiPost('/api/timers/avplayout-sync-align', {
			event_id: eventId,
			item_id: parseInt(itemId, 10),
			user_id: 'companion-avplayout',
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
				tooltip: 'Run of Show Railway API (must include avplayout-* routes)',
			},
			{
				type: 'textinput',
				id: 'apiToken',
				label: 'API Token (optional)',
				width: 12,
				default: '',
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
				type: 'checkbox',
				id: 'followWatchColumn',
				label: 'Follow rundown AV column',
				width: 12,
				default: true,
				tooltip:
					'When AV-Playout next starts playing, load and sync the single ROS row checked in the AV column. Turn off to use only the Arm buttons.',
			},
			{
				type: 'textinput',
				id: 'eventId',
				label: 'Event ID',
				width: 12,
				tooltip: 'UUID from the ROS URL (?eventId=...)',
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
				type: 'textinput',
				id: 'avHost',
				label: 'AV-Playout host',
				width: 8,
				default: '127.0.0.1',
				tooltip: 'PC running SINOR AV-Playout (CasparCG cue deck)',
			},
			{
				type: 'textinput',
				id: 'avPort',
				label: 'AV-Playout HTTP port',
				width: 4,
				default: '8080',
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
				label: 'Follow-up align (ms)',
				width: 6,
				default: 400,
				min: 0,
				max: 5000,
			},
			{
				type: 'number',
				id: 'periodicAlignIntervalSeconds',
				label: 'Periodic re-sync interval (seconds)',
				width: 6,
				default: 10,
				min: 0,
				max: 120,
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
					{ id: 'none', label: 'Do nothing — stop timer' },
					{ id: 'keep_running', label: 'Release lock only (timer keeps running)' },
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
				default: 400,
				min: 0,
				max: 15000,
			},
			{
				type: 'checkbox',
				id: 'stopAvOnClear',
				label: 'Stop AV-Playout / Caspar when disarming, ending sync, or Stop Timer',
				width: 12,
				default: true,
				tooltip:
					'Calls AV-Playout POST /api/transport/stop so the clip stops with the ROS timer. Turn off to only clear ROS sync.',
			},
			{
				type: 'checkbox',
				id: 'clearAvLayerOnStop',
				label: 'Also clear Caspar layer after stop',
				width: 12,
				default: false,
				tooltip: 'After stop, call /api/transport/clear (harder black / empty layer).',
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
		this.checkFeedbacks(
			'avplayout_armed',
			'avplayout_aligned',
			'avplayout_sync_pulse',
			'avplayout_connected'
		)
	}

	updatePresets() {
		const presets = {
			av_play: {
				type: 'button',
				category: 'AV Direct',
				name: 'Play / Fire current',
				style: {
					text: 'Play\n/ Fire',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(0, 140, 60),
				},
				feedbacks: [],
				steps: [{ down: [{ actionId: 'av_play', options: { cueIndex: 0 } }], up: [] }],
			},
			av_pause: {
				type: 'button',
				category: 'AV Direct',
				name: 'Pause',
				style: {
					text: 'Pause',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(180, 120, 20),
				},
				feedbacks: [],
				steps: [{ down: [{ actionId: 'av_pause', options: {} }], up: [] }],
			},
			av_stop: {
				type: 'button',
				category: 'AV Direct',
				name: 'Stop',
				style: {
					text: 'Stop',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(160, 40, 40),
				},
				feedbacks: [],
				steps: [{ down: [{ actionId: 'stop_avplayout_playback', options: {} }], up: [] }],
			},
			arm_av_current: {
				type: 'button',
				category: 'AV Direct',
				name: 'Arm current (no cue select)',
				style: {
					text: 'Arm\nCurrent',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(40, 100, 140),
				},
				feedbacks: [
					{
						feedbackId: 'avplayout_armed',
						options: {},
						style: { bgcolor: combineRgb(160, 80, 200), color: combineRgb(255, 255, 255) },
					},
					{
						feedbackId: 'avplayout_aligned',
						options: {},
						style: { bgcolor: combineRgb(0, 140, 60), color: combineRgb(255, 255, 255) },
					},
				],
				steps: [
					{
						down: [
							{
								actionId: 'arm_avplayout_current',
								options: { cueIndex: 0, triggerOnArm: true },
							},
						],
						up: [],
					},
				],
			},
			send_av_time: {
				type: 'button',
				category: 'AV Direct',
				name: 'Send Time (current)',
				style: {
					text: 'Send\nTime',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(70, 90, 160),
				},
				feedbacks: [
					{
						feedbackId: 'avplayout_sync_pulse',
						options: {},
						style: { bgcolor: combineRgb(0, 180, 80), color: combineRgb(255, 255, 255) },
					},
				],
				steps: [{ down: [{ actionId: 'send_avplayout_time', options: {} }], up: [] }],
			},
			arm_av_generic: {
				type: 'button',
				category: 'AV-Playout',
				name: 'Arm AV-Playout sync (select cue)',
				style: {
					text: 'Arm+Load\n(Select Cue)',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(40, 100, 140),
				},
				feedbacks: [
					{
						feedbackId: 'avplayout_armed',
						options: {},
						style: { bgcolor: combineRgb(160, 80, 200), color: combineRgb(255, 255, 255) },
					},
					{
						feedbackId: 'avplayout_aligned',
						options: {},
						style: { bgcolor: combineRgb(0, 140, 60), color: combineRgb(255, 255, 255) },
					},
				],
				steps: [
					{
						down: [
							{
								actionId: 'arm_avplayout_sync',
								options: { itemId: '', cueIndex: 1, triggerOnArm: true },
							},
						],
						up: [],
					},
				],
			},
			disarm_av: {
				type: 'button',
				category: 'AV-Playout',
				name: 'Disarm AV-Playout sync',
				style: {
					text: 'Disarm',
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(80, 80, 80),
				},
				feedbacks: [],
				steps: [{ down: [{ actionId: 'disarm_avplayout_sync', options: {} }], up: [] }],
			},
		}

		for (const item of this.getRegularCues()) {
			const cueDisplay = this.formatCueDisplay(item.customFields?.cue, item.id)
			presets[`arm_cue_${item.id}`] = {
				type: 'button',
				category: 'AV-Playout Cues',
				name: `Arm + Load ${cueDisplay}`,
				style: {
					text: `${cueDisplay}\nArm+Load`,
					size: 'auto',
					color: combineRgb(255, 255, 255),
					bgcolor: combineRgb(35, 90, 130),
				},
				feedbacks: [
					{
						feedbackId: 'avplayout_armed',
						options: {},
						style: { bgcolor: combineRgb(160, 80, 200), color: combineRgb(255, 255, 255) },
					},
					{
						feedbackId: 'avplayout_aligned',
						options: {},
						style: { bgcolor: combineRgb(0, 140, 60), color: combineRgb(255, 255, 255) },
					},
				],
				steps: [
					{
						down: [
							{
								actionId: 'arm_avplayout_sync',
								options: { itemId: String(item.id), cueIndex: 1, triggerOnArm: true },
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

		const phase = this.avArm?.phase ?? 'off'
		const statusMap = {
			off: 'Off',
			idle: 'Armed — waiting for playback',
			sampling: 'Receiving telemetry — locking…',
			aligned: 'Locked to AV-Playout',
		}
		const drift = this.getEstimatedDriftSeconds()
		const rem =
			this.avDuration > 1 ? Math.max(0, this.avDuration - this.avPosition) : this.avArm?.lastRemaining

		this.setVariableValues({
			avplayout_armed: this.avArm ? 'Yes' : 'No',
			avplayout_sync_status: this.avArm ? statusMap[phase] || phase : 'Off',
			avplayout_cue_index: this.avArm ? String(this.avArm.cueIndex) : '—',
			avplayout_connected: this.avConnected ? 'Yes' : 'No',
			avplayout_phase: this.avPhase || '—',
			avplayout_remaining: rem != null ? String(Math.round(rem * 10) / 10) : '—',
			avplayout_duration: this.avDuration > 0 ? String(Math.round(this.avDuration * 10) / 10) : '—',
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

runEntrypoint(RunOfShowAvPlayoutInstance, UpgradeScripts)
