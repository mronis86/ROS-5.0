/**
 * HTTP client for SINOR AV-Playout (local CasparCG cue deck).
 */

async function request(baseUrl, method, path, body) {
	const url = `${String(baseUrl || '').replace(/\/+$/, '')}${path}`
	const opts = {
		method,
		headers: { Accept: 'application/json' },
	}
	if (body != null) {
		opts.headers['Content-Type'] = 'application/json'
		opts.body = JSON.stringify(body)
	}
	const res = await fetch(url, opts)
	const text = await res.text()
	let data = null
	try {
		data = text ? JSON.parse(text) : null
	} catch {
		data = { raw: text }
	}
	if (!res.ok) {
		const msg = data?.error || data?.raw || res.statusText || `HTTP ${res.status}`
		throw new Error(msg)
	}
	return data
}

module.exports = {
	getState(baseUrl) {
		return request(baseUrl, 'GET', '/api/state')
	},
	play(baseUrl, body = {}) {
		return request(baseUrl, 'POST', '/api/transport/play', body)
	},
	load(baseUrl, body = {}) {
		return request(baseUrl, 'POST', '/api/transport/load', body)
	},
	stop(baseUrl, body = {}) {
		return request(baseUrl, 'POST', '/api/transport/stop', body)
	},
	pause(baseUrl) {
		return request(baseUrl, 'POST', '/api/transport/pause', {})
	},
	resume(baseUrl) {
		return request(baseUrl, 'POST', '/api/transport/resume', {})
	},
	clear(baseUrl, body = {}) {
		return request(baseUrl, 'POST', '/api/transport/clear', body)
	},
}
