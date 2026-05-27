const osc = require('osc')

function positionAddress(layer, clip) {
	return `/composition/layers/${layer}/clips/${clip}/transport/position`
}

function connectAddress(layer, clip) {
	return `/composition/layers/${layer}/clips/${clip}/connect`
}

function columnConnectAddress(column) {
	return `/composition/columns/${column}/connect`
}

function matchesAddress(messageAddress, expected) {
	if (!messageAddress || !expected) return false
	return String(messageAddress).toLowerCase() === String(expected).toLowerCase()
}

function inferDurationFromSamples(samples) {
	if (!samples || samples.length < 2) return null
	const first = samples[0]
	const last = samples[samples.length - 1]
	const deltaPos = last.position - first.position
	const deltaMs = last.timeMs - first.timeMs
	if (deltaPos <= 0.0005 || deltaMs < 50) return null
	const duration = (deltaMs / 1000) / deltaPos
	if (!Number.isFinite(duration) || duration < 1 || duration > 86400) return null
	return Math.round(duration)
}

function remainingFromPosition(durationSeconds, position) {
	return remainingFromPositionPrecise(durationSeconds, position, true)
}

/** Fractional seconds remaining; optional round for display-only */
function remainingFromPositionPrecise(durationSeconds, position, roundToWholeSeconds = false) {
	const pos = Math.max(0, Math.min(1, Number(position) || 0))
	const rem = Math.max(0, durationSeconds * (1 - pos))
	return roundToWholeSeconds ? Math.round(rem) : Math.round(rem * 1000) / 1000
}

module.exports = {
	positionAddress,
	connectAddress,
	columnConnectAddress,
	matchesAddress,
	inferDurationFromSamples,
	remainingFromPosition,
	remainingFromPositionPrecise,
	createUdpPort(port, onMessage, onError) {
		const udpPort = new osc.UDPPort({
			localAddress: '0.0.0.0',
			localPort: port,
			metadata: true,
		})
		udpPort.on('message', onMessage)
		if (onError) udpPort.on('error', onError)
		udpPort.open()
		return udpPort
	},
	sendOsc(remoteAddress, remotePort, address, value = 1) {
		const client = new osc.UDPPort({
			localAddress: '0.0.0.0',
			localPort: 0,
			remoteAddress,
			remotePort,
			metadata: true,
		})
		client.open()
		client.send({
			address,
			args: [{ type: 'f', value: Number(value) }],
		})
		setTimeout(() => {
			try {
				client.close()
			} catch (_) {}
		}, 150)
	},
}
