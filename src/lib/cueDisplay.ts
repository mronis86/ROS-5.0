/** Shared CUE / Delay labels for Run of Show and display views. */

import { isShowBreakProgramType } from './showBreak';

export type DuplicateCueInfo = {
  otherRowNumbers: number[];
};

type DuplicateCueItem = {
  id: number;
  programType?: string | null;
  customFields?: { cue?: unknown } | null;
  cue?: unknown;
};

/** Strip "CUE" prefix and whitespace so "CUE 9" and "9" match. */
export function cueDuplicateKey(cue: unknown): string {
  return String(cue ?? '')
    .trim()
    .replace(/^(cue[\s._-]*)+/i, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function duplicateCueTooltip(otherRowNumbers: number[]): string {
  if (otherRowNumbers.length === 1) return `Same CUE as row ${otherRowNumbers[0]}`;
  return `Same CUE as rows ${otherRowNumbers.join(', ')}`;
}

/** Row numbers are 1-based indexes in the list passed in (same as the # column). */
export function buildDuplicateCueMap(items: DuplicateCueItem[]): Map<number, DuplicateCueInfo> {
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => {
    if (isDelayProgramType(item.programType) || isShowBreakProgramType(item.programType)) return;
    const key = cueDuplicateKey(item.customFields?.cue ?? item.cue);
    if (!key) return;
    const list = groups.get(key);
    if (list) list.push(index);
    else groups.set(key, [index]);
  });
  const out = new Map<number, DuplicateCueInfo>();
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    for (const i of indexes) {
      const item = items[i];
      if (!item) continue;
      out.set(item.id, {
        otherRowNumbers: indexes.filter((j) => j !== i).map((j) => j + 1),
      });
    }
  }
  return out;
}

export function isDelayProgramType(programType?: string | null): boolean {
  return String(programType || '').trim().toLowerCase() === 'delay block';
}

export function formatCueNumber(cue: string | number | undefined | null): string {
  if (cue === 0) return 'CUE 0';
  if (cue == null) return 'CUE';
  const cueStr = String(cue).trim();
  if (!cueStr) return 'CUE';
  if (/^delay(?:\s+block)?$/i.test(cueStr)) return 'DELAY';
  if (cueStr.includes('CUE ')) return cueStr;
  if (/^CUE\d+$/i.test(cueStr)) return cueStr.replace(/^CUE(\d+)$/i, 'CUE $1');
  if (/^CUE\b/i.test(cueStr)) return cueStr.replace(/^CUE\s*/i, 'CUE ');
  return `CUE ${cueStr}`;
}

export function isRawItemIdCue(label: unknown, itemId?: unknown): boolean {
  if (label == null || itemId == null || itemId === '') return false;
  const n = String(label).replace(/^CUE\s*/i, '').trim();
  return n !== '' && n === String(itemId);
}

export function resolveScheduleCueLabel(
  item?: {
    programType?: string | null;
    customFields?: { cue?: unknown } | null;
    cue?: unknown;
  } | null,
  fallbackItemId?: number | string | null
): string {
  if (isDelayProgramType(item?.programType)) return 'DELAY';
  if (isShowBreakProgramType(item?.programType)) return 'BREAK';
  const raw = item?.customFields?.cue ?? item?.cue;
  if (raw != null && String(raw).trim() !== '') {
    return formatCueNumber(raw as string | number);
  }
  if (fallbackItemId != null && fallbackItemId !== '') {
    return `CUE ${fallbackItemId}`;
  }
  return 'CUE';
}

/** Prefer schedule Delay over timer cue_is / item-id fallbacks. */
export function resolveLiveCueLabel(options: {
  item?: {
    programType?: string | null;
    customFields?: { cue?: unknown } | null;
    cue?: unknown;
  } | null;
  timer?: {
    cue_is?: unknown;
    cue_display?: unknown;
    cue?: unknown;
    item_id?: unknown;
  } | null;
}): string {
  if (isDelayProgramType(options.item?.programType)) return 'DELAY';
  if (isShowBreakProgramType(options.item?.programType)) return 'BREAK';
  const fromItem = options.item?.customFields?.cue ?? options.item?.cue;
  if (fromItem != null && String(fromItem).trim() !== '') {
    return formatCueNumber(fromItem as string | number);
  }
  const fromTimer =
    options.timer?.cue_display || options.timer?.cue || options.timer?.cue_is;
  if (fromTimer != null && String(fromTimer).trim() !== '') {
    if (isRawItemIdCue(fromTimer, options.timer?.item_id)) return 'CUE';
    return formatCueNumber(fromTimer as string | number);
  }
  return 'CUE';
}

/** Keep the running cue when a later LOAD (often a leftover Delay) arrives. */
export function shouldKeepExistingRunningTimer(prevTimer: any, incoming: any): boolean {
  if (!prevTimer || !incoming) return false;
  const prevRunning =
    prevTimer.is_active !== false &&
    (prevTimer.is_running || prevTimer.timer_state === 'running');
  if (!prevRunning) return false;
  const incomingRunning =
    incoming.is_active !== false &&
    (incoming.is_running || incoming.timer_state === 'running');
  if (incomingRunning) return false;
  if (prevTimer.item_id == null || incoming.item_id == null) return false;
  return String(prevTimer.item_id) !== String(incoming.item_id);
}

/** Delay never shows RUNNING/LOADED or a raw item id. */
export function formatTimerCueStatus(
  status: 'running' | 'loaded' | 'idle',
  cueLabel: string,
  syncLabel?: string
): string {
  const label = String(cueLabel || '').trim();
  if (/^delay$/i.test(label)) return 'DELAY';
  const sync = syncLabel ? String(syncLabel).trim() : '';
  if (status === 'running') {
    return sync ? `RUNNING · ${sync} - ${label}` : label ? `RUNNING - ${label}` : 'RUNNING';
  }
  if (status === 'loaded') {
    return sync ? `LOADED · ${sync} - ${label}` : label ? `LOADED - ${label}` : 'LOADED';
  }
  return label || 'CUE';
}
