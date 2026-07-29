/**
 * vMix HTTP API client (default http://127.0.0.1:8088/api/).
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

/**
 * Parse Data Source catalog: name + sheet/table names (Excel / Google Sheets).
 * Returns [{ name, tables: string[] }]
 */
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

  // Self-closing / open tags with name= and optional nested content until next dataSource
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
    // Google / Excel keys sometimes listed as <key name="Sheet1">
    for (const m of body.matchAll(/<key\b[^>]*\bname=["']([^"']+)["']/gi)) {
      addTable(dsName, m[1]);
    }
  }

  // Attribute-only / self-closing dataSource tags
  for (const m of xmlText.matchAll(/<dataSource\b([^>]*?)\/>/gi)) {
    const nameMatch = (m[1] || '').match(/\bname=["']([^"']+)["']/i);
    if (nameMatch) ensure(nameMatch[1]);
  }
  for (const m of xmlText.matchAll(/<dataSource\b[^>]*\bname=["']([^"']+)["'][^>]*>/gi)) {
    ensure(m[1]);
  }
  for (const m of xmlText.matchAll(/<dataSources?\b[^>]*\bkey=["']([^"']+)["']/gi)) {
    ensure(m[1]);
  }

  // Fallback name scan if nothing found
  if (byName.size === 0) {
    for (const m of xmlText.matchAll(/DataSource[^>]{0,60}(?:name|key)=["']([^"']+)["']/gi)) {
      ensure(m[1]);
    }
  }

  return [...byName.values()]
    .map((e) => ({ name: e.name, tables: uniqueSorted(e.tables) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseDataSourceNames(xmlText) {
  return parseDataSourceCatalog(xmlText).map((e) => e.name);
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
      message: `Connected to vMix — ${catalog.length} Data Source(s)`,
      dataSourceNames: catalog.map((e) => e.name),
      catalog,
    };
  } catch (err) {
    return { ok: false, message: err.message || 'vMix connection failed' };
  }
}

/**
 * Select a row in a Data Source.
 * Value: DataSourceName,TableOrSheetOrEmpty,ZeroBasedIndex
 */
async function selectRow(host, port, dataSourceName, tableName, zeroBasedIndex) {
  const name = String(dataSourceName || '').trim();
  if (!name) throw new Error('Data Source name is required');
  if (!Number.isFinite(zeroBasedIndex) || zeroBasedIndex < 0) {
    throw new Error(`Invalid row index: ${zeroBasedIndex}`);
  }
  const table = String(tableName || '').trim();
  const value = `${name},${table},${Math.floor(zeroBasedIndex)}`;
  const base = buildBaseUrl(host, port);
  const url = `${base}?Function=DataSourceSelectRow&Value=${encodeURIComponent(value)}`;
  const res = await fetch(url);
  const body = await res.text().catch(() => '');
  if (!res.ok) {
    const err = new Error(`DataSourceSelectRow failed HTTP ${res.status}`);
    err.url = url;
    err.body = body;
    throw err;
  }
  return { ok: true, url, value, index: Math.floor(zeroBasedIndex), body: body.slice(0, 200) };
}

module.exports = {
  buildBaseUrl,
  fetchApiXml,
  parseDataSourceNames,
  parseDataSourceCatalog,
  listDataSources,
  testConnection,
  selectRow,
};
