/**
 * Push button text + background to Bitfocus Companion's HTTP API.
 * Companion → Settings → HTTP API must be enabled.
 * POST /api/location/:page/:row/:column/style
 */

function companionBase(host, port) {
  const h = String(host || '127.0.0.1').trim() || '127.0.0.1';
  const p = Math.max(1, parseInt(String(port), 10) || 8000);
  return `http://${h}:${p}`;
}

async function setButtonStyle(host, port, page, row, column, fields) {
  const url = `${companionBase(host, port)}/api/location/${page}/${row}/${column}/style`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
    body: JSON.stringify(fields),
  });
  const body = await res.text();
  if (res.status === 204 || /no control/i.test(body)) {
    throw new Error(
      `No Companion button at page ${page}, row ${row}, column ${column}. Draw a button there first.`
    );
  }
  if (res.status === 403) {
    throw new Error('Companion HTTP API is off. In Companion: Settings → HTTP API → enable it.');
  }
  if (!res.ok) {
    throw new Error(`Companion HTTP ${res.status} at ${url}${body ? ` — ${body.slice(0, 180)}` : ''}`);
  }
  return { url, body };
}

module.exports = { setButtonStyle, companionBase };
