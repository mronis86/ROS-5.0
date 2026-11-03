'use strict'

const net = require('net')

/**
 * Send one Ross Talk command over TCP.
 * Protocol: plain text, CR or CRLF terminated (we append \r\n if missing).
 */
function sendRossTalkCommand({ host, port, command, timeoutMs = 3000 }) {
	return new Promise((resolve, reject) => {
		const cmd = String(command || '').trim()
		if (!cmd) {
			reject(new Error('Ross Talk command is empty'))
			return
		}
		const h = String(host || '').trim()
		const p = parseInt(port, 10)
		const portNum = Number.isFinite(p) && p > 0 ? p : 7788
		if (!h) {
			reject(new Error('Ross Talk host is empty'))
			return
		}

		const socket = new net.Socket()
		let settled = false
		const done = (err) => {
			if (settled) return
			settled = true
			try {
				socket.destroy()
			} catch (_) {
				/* ignore */
			}
			if (err) reject(err)
			else resolve({ host: h, port: portNum, command: cmd })
		}

		socket.setTimeout(timeoutMs)
		socket.once('timeout', () => done(new Error(`Ross Talk timeout (${h}:${portNum})`)))
		socket.once('error', (err) => done(err))
		socket.connect(portNum, h, () => {
			const payload = /\r|\n$/.test(cmd) ? cmd : `${cmd}\r\n`
			socket.write(payload, (err) => {
				if (err) return done(err)
				// Brief linger so the switcher can read before we tear down
				setTimeout(() => done(null), 40)
			})
		})
	})
}

module.exports = { sendRossTalkCommand }
