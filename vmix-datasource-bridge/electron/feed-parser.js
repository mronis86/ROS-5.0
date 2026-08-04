/**
 * Parse ROS schedule / lower-thirds / custom-columns CSV or XML feeds into
 * normalized data rows for Cue / Row matching.
 *
 * Important: vMix may or may not treat the first CSV row as column names
 * ("Use first row as column names"). This parser always reads the *file* content
 * itself — it does not assume vMix has headers enabled. Callers map dataIndex
 * → DataSourceSelectRow index via vmixUsesHeaderRow.
 */

function normalizeHeaderKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/** Map common ROS header labels → canonical keys. */
function canonicalColumnKey(header) {
  const n = normalizeHeaderKey(header);
  if (!n) return '';
  if (n === 'row' || n === 'rownumber' || n === 'rownum' || n === 'index') return 'row';
  if (n === 'day' || n === 'daynumber') return 'day';
  if (n === 'cue' || n === 'cueis' || n === 'cuenumber' || n === 'cuenum') return 'cue';
  if (n === 'program' || n === 'programtype') return 'program';
  if (n === 'segmentname' || n === 'segment') return 'segment_name';
  if (n === 'id' || n === 'itemid') return 'id';
  return n;
}

function looksLikeHeaderRow(cells) {
  const keys = cells.map(canonicalColumnKey).filter(Boolean);
  if (!keys.length) return false;
  const set = new Set(keys);
  // ROS feeds always start with Row (+ Cue or Day). Also accept bare Cue.
  return set.has('row') || set.has('cue') || set.has('day');
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function splitCsvLines(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const lines = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && raw[i + 1] === '\n') i++;
      if (cur.trim() !== '') lines.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') lines.push(cur);
  return lines;
}

/**
 * @returns {{
 *   format: 'csv'|'xml'|'unknown',
 *   hasHeaderRow: boolean,
 *   columns: string[],
 *   rows: Array<{
 *     fields: Record<string, string>,
 *     dataIndex: number,
 *     physicalIndex: number,
 *     rowNumber: number|null,
 *     day: number|null,
 *     cue: string,
 *   }>
 * }}
 */
function parseCsvFeed(text) {
  const lines = splitCsvLines(text);
  if (!lines.length) {
    return { format: 'csv', hasHeaderRow: false, columns: [], rows: [] };
  }

  const firstCells = parseCsvLine(lines[0]);
  const hasHeaderRow = looksLikeHeaderRow(firstCells);
  let columns = [];
  let dataStart = 0;

  if (hasHeaderRow) {
    columns = firstCells.map((c, i) => canonicalColumnKey(c) || `col${i}`);
    dataStart = 1;
  } else {
    // No reliable header — use ROS schedule positional defaults when wide enough.
    const width = firstCells.length;
    if (width >= 3) {
      columns = ['row', 'day', 'cue'].concat(
        Array.from({ length: Math.max(0, width - 3) }, (_, i) => `col${i + 3}`)
      );
    } else if (width === 2) {
      columns = ['row', 'cue'];
    } else {
      columns = firstCells.map((_, i) => `col${i}`);
    }
    dataStart = 0;
  }

  const rows = [];
  for (let li = dataStart; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]);
    if (!cells.some((c) => String(c || '').trim() !== '')) continue;
    const fields = {};
    for (let i = 0; i < columns.length; i++) {
      fields[columns[i]] = String(cells[i] != null ? cells[i] : '').trim();
    }
    // Also keep raw header labels if present
    if (hasHeaderRow) {
      for (let i = 0; i < firstCells.length; i++) {
        const rawKey = normalizeHeaderKey(firstCells[i]);
        if (rawKey && fields[rawKey] == null) {
          fields[rawKey] = String(cells[i] != null ? cells[i] : '').trim();
        }
      }
    }
    const rowNumber = parseLooseInt(fields.row);
    const day = parseLooseInt(fields.day);
    rows.push({
      fields,
      dataIndex: rows.length,
      physicalIndex: li,
      rowNumber: Number.isFinite(rowNumber) ? rowNumber : null,
      day: Number.isFinite(day) ? day : null,
      cue: String(fields.cue || ''),
    });
  }

  return { format: 'csv', hasHeaderRow, columns, rows };
}

function parseLooseInt(value) {
  const n = parseInt(String(value == null ? '' : value).trim(), 10);
  return Number.isFinite(n) ? n : NaN;
}

function extractXmlTag(block, tag) {
  const re = new RegExp(
    `<${tag}\\b[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${tag}>`,
    'i'
  );
  const m = block.match(re);
  if (!m) return '';
  return String(m[1] != null ? m[1] : m[2] || '').trim();
}

function parseXmlFeed(text) {
  const raw = String(text || '');
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const rows = [];
  let m;
  let physical = 0;
  while ((m = itemRe.exec(raw))) {
    const body = m[1] || '';
    const fields = {
      row: extractXmlTag(body, 'row'),
      day: extractXmlTag(body, 'day'),
      cue: extractXmlTag(body, 'cue'),
      program: extractXmlTag(body, 'program'),
      segment_name: extractXmlTag(body, 'segment_name'),
      id: extractXmlTag(body, 'id'),
    };
    // Capture any other simple child tags for custom cue field names
    for (const tag of body.matchAll(/<([A-Za-z_][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
      const key = canonicalColumnKey(tag[1]);
      if (!key || fields[key] != null && fields[key] !== '') continue;
      const inner = tag[2] || '';
      const cdata = inner.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
      fields[key] = String(cdata ? cdata[1] : inner.replace(/<[^>]+>/g, '')).trim();
    }

    const rowNumber = parseLooseInt(fields.row);
    const day = parseLooseInt(fields.day);
    // Lower-thirds XML has no <row>; fall back to 1-based order.
    const inferredRow = Number.isFinite(rowNumber) ? rowNumber : rows.length + 1;
    rows.push({
      fields,
      dataIndex: rows.length,
      physicalIndex: physical,
      rowNumber: inferredRow,
      day: Number.isFinite(day) ? day : null,
      cue: String(fields.cue || ''),
    });
    physical += 1;
  }

  return {
    format: 'xml',
    hasHeaderRow: false,
    columns: ['row', 'day', 'cue', 'program', 'segment_name', 'id'],
    rows,
  };
}

function detectFormat(text, hintUrl) {
  const url = String(hintUrl || '').toLowerCase();
  const sample = String(text || '').trim().slice(0, 200);
  if (url.includes('.xml') || sample.startsWith('<?xml') || sample.startsWith('<data') || sample.startsWith('<')) {
    return 'xml';
  }
  if (url.includes('.csv') || /^(row|day|cue)\b/i.test(sample)) {
    return 'csv';
  }
  if (sample.includes('<item')) return 'xml';
  return 'csv';
}

function parseFeed(text, hintUrl) {
  const format = detectFormat(text, hintUrl);
  if (format === 'xml') return parseXmlFeed(text);
  return parseCsvFeed(text);
}

/**
 * Append or replace ?day=N on a feed URL.
 */
function withDayQuery(feedUrl, day) {
  const raw = String(feedUrl || '').trim();
  if (!raw) return raw;
  if (day == null || day === '' || Number.isNaN(Number(day))) return raw;
  try {
    const u = new URL(raw);
    u.searchParams.set('day', String(Number(day)));
    return u.toString();
  } catch {
    const cleaned = raw.replace(/([?&])day=\d+/gi, '$1').replace(/[?&]$/, '');
    const join = cleaned.includes('?') ? '&' : '?';
    return `${cleaned}${join}day=${Number(day)}`;
  }
}

/**
 * Map a parsed data row to the 0-based index vMix DataSourceSelectRow expects.
 * - CSV + vMix "Use first row as column names" ON → dataIndex
 * - CSV + that option OFF → physicalIndex (header counts as row 0)
 * - XML → dataIndex (no header row)
 */
function vmixIndexForRow(parsed, row, vmixUsesHeaderRow) {
  if (!row) return -1;
  if (parsed.format === 'xml') return row.dataIndex;
  if (vmixUsesHeaderRow === false) return row.physicalIndex;
  // Default: assume operator ticked "Use first row as column names" for ROS CSV
  return row.dataIndex;
}

function fieldFromRow(row, fieldName) {
  if (!row) return '';
  const want = canonicalColumnKey(fieldName) || normalizeHeaderKey(fieldName);
  if (!want) return row.cue || '';
  if (row.fields && row.fields[want] != null && row.fields[want] !== '') {
    return row.fields[want];
  }
  if (want === 'cue') return row.cue || '';
  if (want === 'row') return row.rowNumber != null ? String(row.rowNumber) : '';
  if (want === 'day') return row.day != null ? String(row.day) : '';
  return '';
}

module.exports = {
  normalizeHeaderKey,
  canonicalColumnKey,
  parseCsvFeed,
  parseXmlFeed,
  parseFeed,
  withDayQuery,
  vmixIndexForRow,
  fieldFromRow,
  looksLikeHeaderRow,
};
