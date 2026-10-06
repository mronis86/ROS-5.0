/**
 * Minimal vMix HTTP client — DataSourceSelectRow only.
 */

function buildBaseUrl(host, port) {
  const h = String(host || '127.0.0.1').trim() || '127.0.0.1';
  const p = Math.max(1, parseInt(String(port || 8088), 10) || 8088);
  return `http://${h}:${p}/api/`;
}

function buildSelectValueCandidates(dataSourceName, tableName, zeroBasedIndex) {
  const name = String(dataSourceName || '').trim();
  const table = String(tableName || '').trim();
  const index = Math.floor(zeroBasedIndex);
  const candidates = [];
  if (table) candidates.push(`${name},${table},${index}`);
  else {
    candidates.push(`${name},${index}`);
    candidates.push(`${name},,${index}`);
  }
  return [...new Set(candidates)];
}

async function testConnection(host, port) {
  try {
    const url = buildBaseUrl(host, port);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.text();
    return { ok: true, message: `Connected to vMix at ${url}` };
  } catch (err) {
    return { ok: false, message: err.message || 'vMix connection failed' };
  }
}

async function selectRow(host, port, dataSourceName, tableName, zeroBasedIndex) {
  const name = String(dataSourceName || '').trim();
  if (!name) throw new Error('Data Source name is required');
  if (!Number.isFinite(zeroBasedIndex) || zeroBasedIndex < 0) {
    throw new Error(`Invalid row index: ${zeroBasedIndex}`);
  }
  const base = buildBaseUrl(host, port);
  const candidates = buildSelectValueCandidates(name, tableName, zeroBasedIndex);
  let lastErr = null;
  for (const value of candidates) {
    const url = `${base}?Function=DataSourceSelectRow&Value=${encodeURIComponent(value)}`;
    try {
      const res = await fetch(url);
      const body = await res.text().catch(() => '');
      if (!res.ok) {
        lastErr = new Error(`DataSourceSelectRow HTTP ${res.status}`);
        continue;
      }
      return { ok: true, url, value, index: Math.floor(zeroBasedIndex), body: body.slice(0, 200) };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('DataSourceSelectRow failed');
}

module.exports = { buildBaseUrl, testConnection, selectRow, buildSelectValueCandidates };
