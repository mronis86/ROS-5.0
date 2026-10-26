function cueBody(cue) {
  return String(cue || '')
    .replace(/^CUE\s*/i, '')
    .trim();
}

function formatStoredCue(body) {
  const next = String(body || '').trim();
  return next ? `CUE ${next}` : 'CUE ';
}

function parseMainCueNumber(cue) {
  const body = cueBody(cue);
  const match = body.match(/^(\d+)(?:\.\d+)?$/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function isCustomCueLabel(cue) {
  const body = cueBody(cue);
  if (!body) return false;
  return !/^\d+(?:\.\d+)?$/.test(body);
}

function groupCueBlocks(items, isChild) {
  const leadingOrphans = [];
  const blocks = [];
  for (const item of items || []) {
    if (isChild(item)) {
      if (blocks.length) blocks[blocks.length - 1].push(item);
      else leadingOrphans.push(item);
    } else {
      blocks.push([item]);
    }
  }
  return { leadingOrphans, blocks };
}

function buildCueReorderScope(dayItems, { activeItemId = null, runningIds = [], isChild }) {
  const items = Array.isArray(dayItems) ? dayItems : [];
  let boundaryIndex = -1;
  if (activeItemId != null) {
    const idx = items.findIndex((item) => item.id === activeItemId);
    if (idx !== -1) boundaryIndex = idx;
  }
  for (const id of runningIds || []) {
    const idx = items.findIndex((item) => item.id === id);
    if (idx !== -1) boundaryIndex = Math.max(boundaryIndex, idx);
  }

  let freezeEnd = boundaryIndex;
  if (boundaryIndex >= 0) {
    for (let i = boundaryIndex + 1; i < items.length; i += 1) {
      if (isChild(items[i])) freezeEnd = i;
      else break;
    }
  }

  const locked = freezeEnd >= 0 ? items.slice(0, freezeEnd + 1) : [];
  const movable = freezeEnd >= 0 ? items.slice(freezeEnd + 1) : items;
  const grouped = groupCueBlocks(movable, isChild);
  return {
    locked,
    movable,
    leadingOrphans: grouped.leadingOrphans,
    blocks: grouped.blocks,
    freezeEnd,
    boundaryIndex,
    liveLocked: freezeEnd >= 0,
  };
}

function defaultStartNumber(locked, isChild) {
  let last = 0;
  for (const item of locked || []) {
    if (isChild(item)) continue;
    const n = parseMainCueNumber(item.customFields && item.customFields.cue);
    if (n != null) last = n;
  }
  return last + 1;
}

function orderBlocks(blocks, orderedParentIds) {
  const byId = new Map((blocks || []).map((block) => [block[0].id, block]));
  const used = new Set();
  const next = [];
  for (const id of orderedParentIds || []) {
    const block = byId.get(id);
    if (!block || used.has(id)) continue;
    next.push(block);
    used.add(id);
  }
  for (const block of blocks || []) {
    if (used.has(block[0].id)) continue;
    next.push(block);
  }
  return next;
}

function previewCueNumbers(blocks, {
  startAt = 1,
  numberCues = true,
  numberSubs = true,
  keepCustomLabels = true,
} = {}) {
  let n = Math.max(1, Number(startAt) || 1);
  const rows = [];
  if (!numberCues) {
    for (const block of blocks || []) {
      for (const item of block) {
        const current = cueBody(item.customFields && item.customFields.cue);
        rows.push({
          id: item.id,
          name: item.segmentName || '',
          current,
          next: current,
          changed: false,
          isChild: item !== block[0],
        });
      }
    }
    return { rows, nextNumber: n };
  }

  for (const block of blocks || []) {
    const parent = block[0];
    const currentParent = cueBody(parent.customFields && parent.customFields.cue);
    const keepLabel = keepCustomLabels && isCustomCueLabel(parent.customFields && parent.customFields.cue);
    const parentNum = keepLabel ? null : n;
    if (!keepLabel) n += 1;
    const nextParent = keepLabel ? currentParent : String(parentNum);
    rows.push({
      id: parent.id,
      name: parent.segmentName || '',
      current: currentParent,
      next: nextParent,
      changed: nextParent !== currentParent,
      isChild: false,
    });
    for (let i = 1; i < block.length; i += 1) {
      const child = block[i];
      const current = cueBody(child.customFields && child.customFields.cue);
      let next = current;
      if (numberSubs && parentNum != null) {
        const candidate = `${parentNum}.${i}`;
        if (candidate.length <= 4) next = candidate;
      }
      rows.push({
        id: child.id,
        name: child.segmentName || '',
        current,
        next,
        changed: next !== current,
        isChild: true,
      });
    }
  }
  return { rows, nextNumber: n };
}

function applyCueReorder(schedule, {
  day,
  orderedParentIds,
  activeItemId = null,
  runningIds = [],
  isChild,
  numberCues = true,
  numberSubs = true,
  keepCustomLabels = true,
  startAt,
} = {}) {
  const dayItems = (schedule || []).filter((item) => (item.day || 1) === day);
  const scope = buildCueReorderScope(dayItems, { activeItemId, runningIds, isChild });
  const orderedBlocks = orderBlocks(scope.blocks, orderedParentIds);
  const start = startAt == null ? defaultStartNumber(scope.locked, isChild) : startAt;
  const preview = previewCueNumbers(orderedBlocks, {
    startAt: start,
    numberCues,
    numberSubs,
    keepCustomLabels,
  });
  const nextById = new Map(preview.rows.map((row) => [row.id, row]));
  const nextDay = [...scope.locked, ...scope.leadingOrphans, ...orderedBlocks.flat()].map((item) => {
    const row = nextById.get(item.id);
    if (!row || !row.changed) return item;
    return {
      ...item,
      customFields: {
        ...(item.customFields || {}),
        cue: formatStoredCue(row.next),
      },
    };
  });
  if (nextDay.length !== dayItems.length) {
    return { schedule, changes: [], nextDay: dayItems, liveLocked: scope.liveLocked };
  }
  let cursor = 0;
  const nextSchedule = (schedule || []).map((item) =>
    (item.day || 1) === day ? nextDay[cursor++] : item
  );
  const orderChanged = scope.blocks.some((block, i) => block[0].id !== (orderedBlocks[i] && orderedBlocks[i][0].id));
  return {
    schedule: nextSchedule,
    nextDay,
    changes: preview.rows.filter((row) => row.changed),
    orderChanged,
    liveLocked: scope.liveLocked,
    preview,
    scope,
  };
}

const api = {
  cueBody,
  formatStoredCue,
  parseMainCueNumber,
  isCustomCueLabel,
  groupCueBlocks,
  buildCueReorderScope,
  defaultStartNumber,
  orderBlocks,
  previewCueNumbers,
  applyCueReorder,
};
module.exports = api;
module.exports.default = api;
