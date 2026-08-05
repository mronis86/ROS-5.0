/**
 * Map a loaded/running cue to a zero-based vMix Data Source row index.
 *
 * Preferred path: match against the same CSV/XML feed vMix is using
 * (Cue column or Row number). Falls back to Railway schedule_items order
 * when no feed rows are provided.
 */

const { vmixIndexForRow, fieldFromRow, canonicalColumnKey } = require('./feed-parser');

function cueFieldFromItem(item) {
  if (!item || typeof item !== 'object') return '';
  const custom = item.customFields || item.custom_fields || {};
  return (
    item.cue_is ||
    item.cueIs ||
    custom.cue ||
    item.cue ||
    item.segmentName ||
    item.segment_name ||
    ''
  );
}

function normalizeCueKey(value) {
  let s = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  s = s.replace(/^cue\s*/i, '').trim();
  return s;
}

function filterScheduleItems(scheduleItems, dayFilter) {
  const list = Array.isArray(scheduleItems) ? scheduleItems : [];
  if (dayFilter == null || dayFilter === '' || Number.isNaN(Number(dayFilter))) {
    return list;
  }
  const day = Number(dayFilter);
  return list.filter((item) => Number(item.day || 1) === day);
}

/**
 * Filter parsed feed rows by Day column when present.
 * If the feed was already day-scoped (?day=N → no Day column / all same day),
 * rows without a day value are kept.
 */
function filterFeedRows(feedRows, dayFilter) {
  const list = Array.isArray(feedRows) ? feedRows : [];
  if (dayFilter == null || dayFilter === '' || Number.isNaN(Number(dayFilter))) {
    return list;
  }
  const day = Number(dayFilter);
  const hasAnyDay = list.some((r) => r && r.day != null && Number.isFinite(Number(r.day)));
  if (!hasAnyDay) return list;
  return list.filter((r) => {
    if (r.day == null || !Number.isFinite(Number(r.day))) return true;
    return Number(r.day) === day;
  });
}

function resolveCueRaw(opts, items, itemId) {
  const timerRow = opts.timerRow || {};
  return (
    timerRow.cue_is ||
    timerRow.cueIs ||
    (Number.isFinite(itemId)
      ? cueFieldFromItem(items.find((item) => Number(item.id) === itemId))
      : '') ||
    ''
  );
}

/**
 * @param {'cueColumn'|'rowIndex'} matchMode
 * @param {object} opts
 * @param {Array} opts.scheduleItems
 * @param {number|string} opts.itemId
 * @param {object} [opts.timerRow]
 * @param {string} [opts.cueColumn] feed column name for cue match (default cue)
 * @param {number|null} [opts.dayFilter]
 * @param {object} [opts.parsedFeed] result of parseFeed()
 * @param {boolean} [opts.csvHeaderIsDataRow] true when vMix does NOT use first row as column names
 * @param {boolean} [opts.vmixUsesHeaderRow] legacy inverted flag (true = header is names)
 */
function resolveRowIndex(matchMode, opts = {}) {
  const items = filterScheduleItems(opts.scheduleItems, opts.dayFilter);
  const itemId = opts.itemId != null ? parseInt(String(opts.itemId), 10) : NaN;
  const parsed = opts.parsedFeed || null;
  const feedRowsAll = parsed && Array.isArray(parsed.rows) ? parsed.rows : [];
  const feedRows = filterFeedRows(feedRowsAll, opts.dayFilter);
  const useFeed = feedRows.length > 0;
  const csvHeaderIsDataRow =
    opts.csvHeaderIsDataRow === true ||
    (opts.csvHeaderIsDataRow == null && opts.vmixUsesHeaderRow === false);
  const cueColumnName = String(opts.cueColumn || 'cue').trim() || 'cue';

  if (!useFeed && !items.length) {
    return { ok: false, message: 'No schedule items or feed rows loaded for matching', index: -1 };
  }

  // Row-index kept for tests / legacy configs; UI is cue-only.
  if (matchMode === 'rowIndex') {
    return resolveByRowNumber({
      items,
      itemId,
      useFeed,
      feedRows,
      parsed,
      csvHeaderIsDataRow,
      dayFilter: opts.dayFilter,
      scheduleItemsAll: opts.scheduleItems,
    });
  }

  return resolveByCueColumn({
    items,
    itemId,
    timerRow: opts.timerRow || {},
    useFeed,
    feedRows,
    parsed,
    csvHeaderIsDataRow,
    cueColumnName,
  });
}

function resolveByRowNumber({
  items,
  itemId,
  useFeed,
  feedRows,
  parsed,
  csvHeaderIsDataRow,
  dayFilter,
  scheduleItemsAll,
}) {
  if (!Number.isFinite(itemId)) {
    return { ok: false, message: 'Missing item_id for row-number match', index: -1 };
  }

  const scheduleIndex = items.findIndex((item) => Number(item.id) === itemId);
  if (scheduleIndex < 0) {
    return {
      ok: false,
      message: `item_id ${itemId} not found in schedule (day filter may exclude it)`,
      index: -1,
      itemId,
    };
  }

  const cueValue = String(cueFieldFromItem(items[scheduleIndex]) || '');

  // All-days ROS feeds number Row globally (1..N). Day-scoped ?day=N feeds restart at 1.
  // If the parsed feed still contains multiple Day values, use the global schedule index.
  const allItems = Array.isArray(scheduleItemsAll) ? scheduleItemsAll : items;
  const feedDays = new Set(
    (Array.isArray(parsed?.rows) ? parsed.rows : [])
      .map((r) => r.day)
      .filter((d) => d != null && Number.isFinite(Number(d)))
      .map(Number)
  );
  const feedLooksAllDays = feedDays.size > 1;
  let targetRowNumber = scheduleIndex + 1;
  if (feedLooksAllDays) {
    const globalIndex = allItems.findIndex((item) => Number(item.id) === itemId);
    if (globalIndex >= 0) targetRowNumber = globalIndex + 1;
  }

  if (useFeed) {
    // Prefer exact Row match; when dayFilter set and feed is all-days, also require Day.
    let hit = null;
    if (feedLooksAllDays && dayFilter != null && !Number.isNaN(Number(dayFilter))) {
      hit = (parsed.rows || []).find(
        (r) => Number(r.rowNumber) === targetRowNumber && Number(r.day) === Number(dayFilter)
      );
    }
    if (!hit) {
      hit = feedRows.find((r) => Number(r.rowNumber) === targetRowNumber);
    }
    if (!hit && cueValue) {
      // Last resort: same cue in the (day-filtered) feed — handles LT XML without <row>
      const cueKey = normalizeCueKey(cueValue);
      hit = feedRows.find((r) => normalizeCueKey(r.cue) === cueKey);
    }
    if (!hit) {
      return {
        ok: false,
        message: `No feed row with Row=${targetRowNumber} (day filter=${dayFilter == null ? 'all' : dayFilter})`,
        index: -1,
        itemId,
        cueValue,
        targetRowNumber,
        source: 'feed',
      };
    }
    const index = vmixIndexForRow(parsed, hit, csvHeaderIsDataRow);
    return {
      ok: true,
      mode: 'rowIndex',
      index,
      itemId,
      cueValue,
      targetRowNumber,
      feedRowNumber: hit.rowNumber,
      source: 'feed',
      message: `Row ${hit.rowNumber ?? targetRowNumber} → vMix index ${index} (from feed Row column)`,
    };
  }

  // Fallback: schedule order index (assumes vMix rows align 1:1 with filtered schedule)
  return {
    ok: true,
    mode: 'rowIndex',
    index: scheduleIndex,
    itemId,
    cueValue,
    targetRowNumber,
    source: 'schedule',
    message: `Row index ${scheduleIndex} (0-based) for item_id ${itemId} — set Feed URL for Row-column matching`,
  };
}

function resolveByCueColumn({
  items,
  itemId,
  timerRow,
  useFeed,
  feedRows,
  parsed,
  csvHeaderIsDataRow,
  cueColumnName,
}) {
  const cueRaw = resolveCueRaw({ timerRow }, items, itemId);
  const cueKey = normalizeCueKey(cueRaw);
  if (!cueKey) {
    return {
      ok: false,
      message: 'No cue value available to match (timer cue_is / schedule cue empty)',
      index: -1,
      itemId: Number.isFinite(itemId) ? itemId : undefined,
    };
  }

  if (useFeed) {
    const col = canonicalColumnKey(cueColumnName) || 'cue';
    const hit = feedRows.find((r) => normalizeCueKey(fieldFromRow(r, col) || r.cue) === cueKey);
    if (!hit) {
      return {
        ok: false,
        message: `No feed row matched cue "${cueRaw}" in column "${cueColumnName}"`,
        index: -1,
        cueValue: String(cueRaw),
        itemId: Number.isFinite(itemId) ? itemId : undefined,
        source: 'feed',
      };
    }
    const index = vmixIndexForRow(parsed, hit, csvHeaderIsDataRow);
    return {
      ok: true,
      mode: 'cueColumn',
      index,
      cueValue: String(cueRaw),
      itemId: Number.isFinite(itemId) ? itemId : undefined,
      feedRowNumber: hit.rowNumber,
      source: 'feed',
      message: `Cue "${cueRaw}" → vMix index ${index} (feed ${col} column${hit.rowNumber != null ? `, Row ${hit.rowNumber}` : ''})`,
    };
  }

  // Fallback: match cue on schedule_items, use that array index
  const index = items.findIndex((item) => normalizeCueKey(cueFieldFromItem(item)) === cueKey);
  if (index < 0) {
    return {
      ok: false,
      message: `No schedule row matched cue "${cueRaw}"`,
      index: -1,
      cueValue: String(cueRaw),
      itemId: Number.isFinite(itemId) ? itemId : undefined,
      source: 'schedule',
    };
  }

  return {
    ok: true,
    mode: 'cueColumn',
    index,
    cueValue: String(cueRaw),
    itemId: Number(items[index].id),
    source: 'schedule',
    message: `Cue "${cueRaw}" → row index ${index} — set Feed URL to match the CSV/XML Cue column`,
  };
}

module.exports = {
  cueFieldFromItem,
  normalizeCueKey,
  filterScheduleItems,
  filterFeedRows,
  resolveRowIndex,
};
