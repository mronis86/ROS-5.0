const osc = require('osc')

/**
 * Mitti OSC notes:
 * - Input (Companion → Mitti): Preferences → OSC Controls, default UDP 51000
 * - Feedback (Mitti → Companion): enable OSC Feedback to Companion PC, default 51001
 * - currentCueTRT / cueTimeLeft only reflect the *current* cue.
 *   To pull TRT for another cue without leaving it selected: select → wait for TRT → restore.
 */

const FEEDBACK = {
	CUE_TIME_LEFT: '/mitti/cueTimeLeft',
	CUE_TIME_ELAPSED: '/mitti/cueTimeElapsed',
	CURRENT_CUE_TRT: '/mitti/currentCueTRT',
	TOGGLE_PLAY: '/mitti/togglePlay',
	CURRENT_CUE_NAME: '/mitti/currentCueName',
	RESEND_FEEDBACK: '/mitti/resendOSCFeedback',
}

function cueSelectAddress(cueNumber) {
	return `/mitti/${Math.max(1, parseInt(cueNumber, 10) || 1)}/select`
}

function cuePlayAddress(cueNumber) {
	return `/mitti/${Math.max(1, parseInt(cueNumber, 10) || 1)}/play`
}

function playPlaylistAddress() {
	return '/mitti/play'
}

function matchesAddress(messageAddress, expected) {
	if (!messageAddress || !expected) return false
	return String(messageAddress).toLowerCase() === String(expected).toLowerCase()
}

/** Parse Mitti timecode hh:mm:ss:ff or hh:mm:ss → seconds. */
function parseTimecodeToSeconds(raw, fps = 30) {
	if (raw == null) return null
	const s = String(raw).trim()
	if (!s) return null
	if (!s.includes(':')) {
		const num = Number(s)
		return Number.isFinite(num) && num >= 0 ? num : null
	}
	const parts = s.split(':').map((p) => parseInt(p, 10))
	if (parts.some((p) => !Number.isFinite(p))) return null
	if (parts.length === 4) {
		const [h, m, sec, frames] = parts
		return h * 3600 + m * 60 + sec + frames / Math.max(1, fps)
	}
	if (parts.length === 3) {
		const [h, m, sec] = parts
		return h * 3600 + m * 60 + sec
	}
	return null
}

function createUdpPort(port, onMessage, onError) {
	const udpPort = new osc.UDPPort({
		localAddress: '0.0.0.0',
		localPort: port,
		metadata: true,
	})
	udpPort.on('message', onMessage)
	if (onError) udpPort.on('error', onError)
	udpPort.open()
	return udpPort
}

function sendOsc(remoteAddress, remotePort, address, options = {}) {
	const { type = 'none', value } = options
	const client = new osc.UDPPort({
		localAddress: '0.0.0.0',
		localPort: 0,
		remoteAddress,
		remotePort,
		metadata: true,
	})
	client.open()
	const msg = { address }
	if (type === 'int') {
		msg.args = [{ type: 'i', value: parseInt(value, 10) || 0 }]
	} else if (type === 'float') {
		msg.args = [{ type: 'f', value: Number(value) }]
	} else if (type === 'string') {
		msg.args = [{ type: 's', value: String(value ?? '') }]
	}
	client.send(msg)
	setTimeout(() => {
		try {
			client.close()
		} catch (_) {}
	}, 150)
}

module.exports = {
	FEEDBACK,
	cueSelectAddress,
	cuePlayAddress,
	playPlaylistAddress,
	matchesAddress,
	parseTimecodeToSeconds,
	createUdpPort,
	sendOsc,
}
