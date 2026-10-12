/**
 * Push button text + background to Bitfocus Companion.
 * 3 / 5: POST /api/location/:page/:row/:column/style  (row and column start at 0)
 * 2.4:   GET  /style/bank/:page/:bank/?text=&bgcolor=  (bank starts at 1, 8 columns)
 */

const V2_COLUMNS = 8;

function companionBase(host, port) {
  const h = String(host || '127.0.0.1').trim() || '127.0.0.1';
  const p = Math.max(1, parseInt(String(port), 10) || 8000);
  return `http://${h}:${p}`;
}

function bankFromRowColumn(row, column) {
  return row * V2_COLUMNS + column + 1;
}

function shortenBody(body) {
  const pre = String(body || '').match(/<pre>([^<]+)<\/pre>/i);
  if (pre) return pre[1].trim();
  return String(body || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

async function setButtonStyleV3(host, port, page, row, column, fields) {
  const url = `${companionBase(host, port)}/api/location/${page}/${row}/${column}/style`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
    body: JSON.stringify(fields),
  });
  const body = await res.text();
  if (res.status === 404 && /Cannot POST|Cannot GET/i.test(body)) {
    const err = new Error('Companion 2.x does not have /api/location');
    err.code = 'NO_V3_ROUTE';
    throw err;
  }
  if (res.status === 204 || /no control/i.test(body)) {
    throw new Error(
      `No Companion button at page ${page}, row ${row}, column ${column}. Draw a button there first.`
    );
  }
  if (res.status === 403) {
    throw new Error('Companion HTTP API is off. In Companion: Settings → HTTP API → enable it.');
  }
  if (!res.ok) {
    throw new Error(`Companion HTTP ${res.status} at ${url}${body ? ` — ${shortenBody(body)}` : ''}`);
  }
  return { url, body, api: 'v3' };
}

async function setButtonStyleV2(host, port, page, row, column, fields) {
  const bank = bankFromRowColumn(row, column);
  const params = new URLSearchParams();
  if (fields.size) params.set('size', String(fields.size));
  if (fields.text !== undefined) params.set('text', fields.text);
  if (fields.bgcolor) params.set('bgcolor', String(fields.bgcolor).replace(/^#/, ''));
  if (fields.color) params.set('color', String(fields.color).replace(/^#/, ''));
  if (fields.png64 !== undefined) params.set('png64', fields.png64);
  if (fields.alignment) params.set('alignment', fields.alignment);
  if (fields.pngalignment) params.set('pngalignment', fields.pngalignment);
  const base = `${companionBase(host, port)}/style/bank/${page}/${bank}/`;
  // Companion 2.4 writes png64 only from the GET query. A POST can answer ok and leave the old picture.
  const url = `${base}?${params.toString()}`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'text/plain' } });
  const body = await res.text();
  if (res.status === 404 || /no control|out of range|not found/i.test(body)) {
    throw new Error(
      `No Companion 2.4 button at page ${page}, button ${bank} (row ${row}, column ${column} on an 8-wide page).`
    );
  }
  if (!res.ok) {
    const where = url.length > 160 ? `${url.slice(0, 120)}…` : url;
    throw new Error(`Companion 2.4 HTTP ${res.status} at ${where}${body ? ` — ${shortenBody(body)}` : ''}`);
  }
  const reply = String(body || '').trim();
  if (fields.png64 && reply && !/^ok$/i.test(reply)) {
    throw new Error(`Companion kept the old picture: ${shortenBody(reply)}`);
  }
  return { url, body, api: 'v2', bank };
}

/**
 * apiVersion: 'auto' | 'v2' | 'v3'
 * auto tries Companion 3/5 first, then 2.4 when that route does not exist.
 */
async function setButtonStyle(host, port, page, row, column, fields, apiVersion) {
  const mode = apiVersion === 'v2' || apiVersion === 'v3' ? apiVersion : 'auto';
  if (mode === 'v2') return setButtonStyleV2(host, port, page, row, column, fields);
  if (mode === 'v3') return setButtonStyleV3(host, port, page, row, column, fields);
  try {
    return await setButtonStyleV3(host, port, page, row, column, fields);
  } catch (err) {
    if (err && err.code === 'NO_V3_ROUTE') {
      return setButtonStyleV2(host, port, page, row, column, fields);
    }
    throw err;
  }
}

module.exports = { setButtonStyle, companionBase, bankFromRowColumn, V2_COLUMNS };
