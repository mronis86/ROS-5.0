/**
 * vMix HTTP API client — same patterns as ros-vmix-datasource-bridge.
 */

function buildBaseUrl(host, port) {
  const h = String(host || '127.0.0.1').trim() || '127.0.0.1';
  const p = Math.max(1, parseInt(String(port || 8088), 10) || 8088);
  return `http://${h}:${p}/api/`;
}

async function fetchApiXml(host, port) {
  const url = buildBaseUrl(host, port);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`vMix API HTTP ${res.status}`);
  return res.text();
}

function uniqueSorted(list) {
  return [...new Set((list || []).map((s) => String(s || '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function parseDataSourceCatalog(xmlText) {
  const byName = new Map();

  function ensure(name) {
    const key = String(name || '').trim();
    if (!key) return null;
    if (!byName.has(key)) byName.set(key, { name: key, tables: [] });
    return byName.get(key);
  }

  function addTable(dsName, tableName) {
    const entry = ensure(dsName);
    if (!entry) return;
    const t = String(tableName || '').trim();
    if (t && !entry.tables.includes(t)) entry.tables.push(t);
  }

  if (!xmlText || typeof xmlText !== 'string') return [];

  const blockRe = /<dataSource\b([^>]*)>([\s\S]*?)<\/dataSource>/gi;
  let block;
  while ((block = blockRe.exec(xmlText))) {
    const attrs = block[1] || '';
    const body = block[2] || '';
    const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i) || body.match(/<name>([^<]+)<\/name>/i);
    const dsName = nameMatch ? nameMatch[1].trim() : '';
    if (!dsName) continue;
    ensure(dsName);
    for (const m of body.matchAll(/<(?:table|sheet|worksheet)\b[^>]*\bname=["']([^"']+)["']/gi)) {
      addTable(dsName, m[1]);
    }
    for (const m of body.matchAll(/<(?:table|sheet|worksheet)>([^<]+)<\/(?:table|sheet|worksheet)>/gi)) {
      addTable(dsName, m[1]);
    }
    for (const m of body.matchAll(/<key\b[^>]*\bname=["']([^"']+)["']/gi)) {
      addTable(dsName, m[1]);
    }
  }

  for (const m of xmlText.matchAll(/<dataSource\b([^>]*?)\/>/gi)) {
    const nameMatch = (m[1] || '').match(/\bname=["']([^"']+)["']/i);
    if (nameMatch) ensure(nameMatch[1]);
  }
  for (const m of xmlText.matchAll(/<dataSource\b[^>]*\bname=["']([^"']+)["'][^>]*>/gi)) {
    ensure(m[1]);
  }

  return [...byName.values()]
    .map((e) => ({ name: e.name, tables: uniqueSorted(e.tables) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Current DataSourceSelectRow index for one source, if vMix put it in /api XML.
 * Returns a number, or null when that source does not report a row.
 */
function parseDataSourceSelectedRow(xmlText, dataSourceName) {
  const want = String(dataSourceName || '').trim().toLowerCase();
  if (!want || !xmlText) return null;

  function rowFrom(attrs, body) {
    const attr = String(attrs || '').match(/\b(?:selectedRow|currentRow|row)=["'](\d+)["']/i);
    if (attr) return Number(attr[1]);
    const tagged = String(body || '').match(/<(?:selectedRow|currentRow)>(\d+)<\/(?:selectedRow|currentRow)>/i);
    if (tagged) return Number(tagged[1]);
    const plain = String(body || '').match(/<row>(\d+)<\/row>/i);
    if (plain) return Number(plain[1]);
    return null;
  }

  const blockRe = /<dataSource\b([^>]*)>([\s\S]*?)<\/dataSource>/gi;
  let block;
  while ((block = blockRe.exec(xmlText))) {
    const attrs = block[1] || '';
    const body = block[2] || '';
    const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i) || body.match(/<name>([^<]*)<\/name>/i);
    const name = nameMatch ? nameMatch[1].trim().toLowerCase() : '';
    if (name !== want) continue;
    return rowFrom(attrs, body);
  }

  for (const m of xmlText.matchAll(/<dataSource\b([^>]*?)\/>/gi)) {
    const attrs = m[1] || '';
    const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i);
    if (!nameMatch || nameMatch[1].trim().toLowerCase() !== want) continue;
    return rowFrom(attrs, '');
  }
  return null;
}

async function listDataSources(host, port) {
  const xml = await fetchApiXml(host, port);
  const catalog = parseDataSourceCatalog(xml);
  return {
    catalog,
    names: catalog.map((e) => e.name),
    xmlLength: xml.length,
  };
}

async function testConnection(host, port) {
  try {
    const xml = await fetchApiXml(host, port);
    const catalog = parseDataSourceCatalog(xml);
    return {
      ok: true,
      message:
        catalog.length > 0
          ? `Connected to vMix — ${catalog.length} Data Source(s) found`
          : 'Connected to vMix. Type the exact Data Source name from vMix (API may not list them).',
      dataSourceNames: catalog.map((e) => e.name),
      catalog,
    };
  } catch (err) {
    return { ok: false, message: err.message || 'vMix connection failed' };
  }
}

function buildSelectValueCandidates(dataSourceName, tableName, zeroBasedIndex) {
  const name = String(dataSourceName || '').trim();
  const table = String(tableName || '').trim();
  const index = Math.floor(zeroBasedIndex);
  const candidates = [];
  if (table) {
    candidates.push(`${name},${table},${index}`);
    // Some builds accept Name,,Index even when a sheet is configured
    candidates.push(`${name},,${index}`);
    candidates.push(`${name},${index}`);
  } else {
    candidates.push(`${name},${index}`);
    candidates.push(`${name},,${index}`);
  }
  return [...new Set(candidates)];
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
  const tried = [];

  for (const value of candidates) {
    const url = `${base}?Function=DataSourceSelectRow&Value=${encodeURIComponent(value)}`;
    tried.push(value);
    try {
      const res = await fetch(url);
      const body = await res.text().catch(() => '');
      if (!res.ok) {
        lastErr = new Error(`DataSourceSelectRow HTTP ${res.status} for Value=${value}`);
        lastErr.url = url;
        lastErr.body = body;
        lastErr.value = value;
        continue;
      }
      return {
        ok: true,
        url,
        value,
        index: Math.floor(zeroBasedIndex),
        body: body.slice(0, 200),
        tried,
      };
    } catch (err) {
      lastErr = err;
      lastErr.url = url;
      lastErr.value = value;
    }
  }

  const err = lastErr || new Error('DataSourceSelectRow failed');
  err.tried = tried;
  throw err;
}

module.exports = {
  buildBaseUrl,
  fetchApiXml,
  testConnection,
  listDataSources,
  selectRow,
  buildSelectValueCandidates,
  parseDataSourceSelectedRow,
};
