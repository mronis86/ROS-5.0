/**
 * Map a loaded/running cue to a zero-based vMix Data Source row index.
 */

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
 * @param {'cueColumn'|'rowIndex'} matchMode
 * @param {object} opts
 * @param {Array} opts.scheduleItems
 * @param {number|string} opts.itemId
 * @param {object} [opts.timerRow] active timer row (may include cue_is)
 * @param {string} [opts.cueColumn] unused for schedule_items model (always uses cue fields)
 * @param {number|null} [opts.dayFilter]
 */
function resolveRowIndex(matchMode, opts = {}) {
  const items = filterScheduleItems(opts.scheduleItems, opts.dayFilter);
  const itemId = opts.itemId != null ? parseInt(String(opts.itemId), 10) : NaN;
  const timerRow = opts.timerRow || {};

  if (!items.length) {
    return { ok: false, message: 'No schedule items loaded for matching', index: -1 };
  }

  if (matchMode === 'rowIndex') {
    if (!Number.isFinite(itemId)) {
      return { ok: false, message: 'Missing item_id for row-index match', index: -1 };
    }
    const index = items.findIndex((item) => Number(item.id) === itemId);
    if (index < 0) {
      return {
        ok: false,
        message: `item_id ${itemId} not found in schedule (day filter may exclude it)`,
        index: -1,
        itemId,
      };
    }
    return {
      ok: true,
      mode: 'rowIndex',
      index,
      itemId,
      cueValue: String(cueFieldFromItem(items[index]) || timerRow.cue_is || ''),
      message: `Row index ${index} (0-based) for item_id ${itemId}`,
    };
  }

  // cueColumn — find by normalized cue text using schedule_items as the row model
  // (same order as ROS schedule XML/CSV fed into vMix).
  let cueRaw =
    timerRow.cue_is ||
    timerRow.cueIs ||
    (Number.isFinite(itemId)
      ? cueFieldFromItem(items.find((item) => Number(item.id) === itemId))
      : '') ||
    '';

  const cueKey = normalizeCueKey(cueRaw);
  if (!cueKey) {
    return {
      ok: false,
      message: 'No cue value available to match (timer cue_is / schedule cue empty)',
      index: -1,
      itemId: Number.isFinite(itemId) ? itemId : undefined,
    };
  }

  const index = items.findIndex((item) => normalizeCueKey(cueFieldFromItem(item)) === cueKey);
  if (index < 0) {
    return {
      ok: false,
      message: `No schedule row matched cue "${cueRaw}"`,
      index: -1,
      cueValue: String(cueRaw),
      itemId: Number.isFinite(itemId) ? itemId : undefined,
    };
  }

  return {
    ok: true,
    mode: 'cueColumn',
    index,
    cueValue: String(cueRaw),
    itemId: Number(items[index].id),
    message: `Cue "${cueRaw}" → row index ${index}`,
  };
}

module.exports = {
  cueFieldFromItem,
  normalizeCueKey,
  filterScheduleItems,
  resolveRowIndex,
};
