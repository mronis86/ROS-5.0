export type CueRenumberItem = {
  id: number;
  day?: number;
  segmentName?: string;
  customFields?: Record<string, string>;
  isIndented?: boolean;
  isTimedMarker?: boolean;
};

export type CueNumberPreviewRow = {
  id: number;
  name: string;
  current: string;
  next: string;
  changed: boolean;
  isChild: boolean;
};

export function cueBody(cue?: string): string {
  return String(cue || '')
    .replace(/^CUE\s*/i, '')
    .trim();
}

export function formatStoredCue(body: string): string {
  const next = String(body || '').trim();
  return next ? `CUE ${next}` : 'CUE ';
}

export type CueParts = {
  kind: 'empty' | 'number' | 'letter' | 'decimal' | 'named';
  n: number | null;
  letter: string;
  sub: number | null;
};

export function parseCueParts(cue?: string): CueParts {
  const body = cueBody(cue);
  if (!body) return { kind: 'empty', n: null, letter: '', sub: null };
  const decimalLetter = body.match(/^(\d+)([A-Za-z]+)\.(\d+)$/);
  if (decimalLetter) {
    return {
      kind: 'decimal',
      n: Number(decimalLetter[1]),
      letter: decimalLetter[2].toUpperCase(),
      sub: Number(decimalLetter[3]),
    };
  }
  const decimal = body.match(/^(\d+)\.(\d+)$/);
  if (decimal) {
    return { kind: 'decimal', n: Number(decimal[1]), letter: '', sub: Number(decimal[2]) };
  }
  const letter = body.match(/^(\d+)([A-Za-z]+)$/);
  if (letter) {
    return { kind: 'letter', n: Number(letter[1]), letter: letter[2].toUpperCase(), sub: null };
  }
  const num = body.match(/^(\d+)$/);
  if (num) return { kind: 'number', n: Number(num[1]), letter: '', sub: null };
  return { kind: 'named', n: null, letter: '', sub: null };
}

export function formatCueParts(n: number | string, letter = '', sub: number | null = null): string {
  const head = `${n}${letter || ''}`;
  return sub == null ? head : `${head}.${sub}`;
}

export function parseMainCueNumber(cue?: string): number | null {
  const parts = parseCueParts(cue);
  return parts.n;
}

export function isCustomCueLabel(cue?: string): boolean {
  return parseCueParts(cue).kind === 'named';
}

export function isDecimalSubCue(cue?: string): boolean {
  return parseCueParts(cue).kind === 'decimal';
}

export function groupCueBlocks<T extends CueRenumberItem>(
  items: T[],
  isChild: (item: T) => boolean
): { leadingOrphans: T[]; blocks: T[][] } {
  const leadingOrphans: T[] = [];
  const blocks: T[][] = [];
  for (const item of items || []) {
    const asSub = isChild(item) || isDecimalSubCue(item.customFields && item.customFields.cue);
    if (asSub) {
      if (blocks.length) blocks[blocks.length - 1].push(item);
      else leadingOrphans.push(item);
    } else {
      blocks.push([item]);
    }
  }
  return { leadingOrphans, blocks };
}

export function buildCueReorderScope<T extends { id: number }>(
  dayItems: T[],
  opts: { activeItemId?: number | null; runningIds?: number[]; isChild: (item: T) => boolean }
): {
  locked: T[];
  movable: T[];
  leadingOrphans: T[];
  blocks: T[][];
  freezeEnd: number;
  boundaryIndex: number;
  liveLocked: boolean;
} {
  const items = Array.isArray(dayItems) ? dayItems : [];
  const { activeItemId = null, runningIds = [], isChild } = opts;
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

export function defaultStartNumber<T extends CueRenumberItem>(
  locked: T[],
  isChild: (item: T) => boolean
): number {
  let last = 0;
  for (const item of locked || []) {
    if (isChild(item)) continue;
    const n = parseMainCueNumber(item.customFields && item.customFields.cue);
    if (n != null) last = n;
  }
  return last + 1;
}

export function orderBlocks<T extends { id: number }>(
  blocks: T[][],
  orderedParentIds: number[]
): T[][] {
  const byId = new Map((blocks || []).map((block) => [block[0].id, block]));
  const used = new Set<number>();
  const next: T[][] = [];
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

export function previewCueNumbers<T extends CueRenumberItem>(
  blocks: T[][],
  opts?: {
    startAt?: number;
    numberCues?: boolean;
    numberSubs?: boolean;
    keepCustomLabels?: boolean;
    skippedIds?: number[];
  }
): { rows: CueNumberPreviewRow[]; nextNumber: number } {
  const startAt = opts?.startAt ?? 1;
  const numberCues = opts?.numberCues !== false;
  const numberSubs = opts?.numberSubs !== false;
  const keepCustomLabels = opts?.keepCustomLabels !== false;
  const skipped = new Set(opts?.skippedIds || []);
  let n = Number(startAt);
  if (!Number.isFinite(n) || n < 0) n = 1;
  const rows: CueNumberPreviewRow[] = [];

  const pushRow = (item: T, next: string, isChild: boolean, locked: boolean) => {
    const current = cueBody(item.customFields && item.customFields.cue);
    rows.push({
      id: item.id,
      name: item.segmentName || '',
      current,
      next: locked ? current : next,
      changed: !locked && next !== current,
      isChild,
    });
  };

  if (!numberCues) {
    for (const block of blocks || []) {
      for (const item of block) pushRow(item, cueBody(item.customFields && item.customFields.cue), item !== block[0], true);
    }
    return { rows, nextNumber: n };
  }

  for (const block of blocks || []) {
    const parent = block[0];
    const currentParent = cueBody(parent.customFields && parent.customFields.cue);
    const parentParts = parseCueParts(currentParent);
    const skipParent = skipped.has(parent.id);
    const keepLabel = keepCustomLabels && parentParts.kind === 'named';
    let nextParent = currentParent;
    let subBase = currentParent.replace(/\.\d+$/, '') || currentParent;
    if (!skipParent && !keepLabel) {
      nextParent =
        parentParts.kind === 'letter' || parentParts.letter
          ? formatCueParts(n, parentParts.letter)
          : String(n);
      subBase = nextParent;
      n += 1;
    }
    pushRow(parent, nextParent, false, skipParent);
    let subIndex = 1;
    for (let i = 1; i < block.length; i += 1) {
      const child = block[i];
      const skipChild = skipped.has(child.id);
      let next = cueBody(child.customFields && child.customFields.cue);
      if (!skipChild && numberSubs && subBase) {
        const candidate = `${subBase}.${subIndex}`;
        if (candidate.length <= 6) next = candidate;
        subIndex += 1;
      } else if (!skipChild && !numberSubs && !keepLabel) {
        next = String(n);
        n += 1;
      }
      pushRow(child, next, true, skipChild);
    }
  }
  return { rows, nextNumber: n };
}

export function applyCueReorder<T extends CueRenumberItem>(
  schedule: T[],
  opts: {
    day: number;
    orderedParentIds: number[];
    activeItemId?: number | null;
    runningIds?: number[];
    isChild: (item: T) => boolean;
    numberCues?: boolean;
    numberSubs?: boolean;
    keepCustomLabels?: boolean;
    startAt?: number;
  }
): {
  schedule: T[];
  nextDay: T[];
  changes: CueNumberPreviewRow[];
  orderChanged: boolean;
  liveLocked: boolean;
} {
  const {
    day,
    orderedParentIds,
    activeItemId = null,
    runningIds = [],
    isChild,
    numberCues = true,
    numberSubs = true,
    keepCustomLabels = true,
    startAt,
  } = opts;
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
    return { schedule, changes: [], nextDay: dayItems, orderChanged: false, liveLocked: scope.liveLocked };
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
  };
}

/** Relabel cue fields only. Never changes row order. */
export function applyCueLabels<T extends CueRenumberItem>(
  schedule: T[],
  updates: { id: number; next: string }[]
): { schedule: T[]; changeCount: number } {
  const nextById = new Map(
    (updates || []).map((row) => [row.id, String(row.next || '').trim()])
  );
  let changeCount = 0;
  const nextSchedule = (schedule || []).map((item) => {
    if (!nextById.has(item.id)) return item;
    const next = formatStoredCue(nextById.get(item.id) || '');
    const current = formatStoredCue(cueBody(item.customFields && item.customFields.cue));
    if (next === current) return item;
    changeCount += 1;
    return {
      ...item,
      customFields: {
        ...(item.customFields || {}),
        cue: next,
      },
    };
  });
  return { schedule: nextSchedule, changeCount };
}
