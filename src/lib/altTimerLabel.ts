/**
 * Secondary / sub-cue timer label parts for Clock & Fullscreen.
 * Badge is "ALT" for indented/op timers, or "Q&A Timer" for planned Q&A secondaries.
 */

export type AltTimerParts = {
  cueLabel: string;
  segment: string;
};

type SecondaryTimerLike = {
  cue_display?: string | null;
  cue?: string | null;
  cue_is?: string | null;
  item_id?: number | string | null;
  segment_name?: string | null;
  segmentName?: string | null;
  source?: string | null;
  timer_id?: string | null;
  timerId?: string | null;
  programType?: string | null;
  program_type?: string | null;
  qaIsAutoQa?: boolean | null;
};

function findScheduleItemForTimer(
  timer: SecondaryTimerLike | null | undefined,
  scheduleItems?: any[] | null
): any | null {
  if (!scheduleItems?.length || timer?.item_id == null) return null;
  return (
    scheduleItems.find(
      (i: any) =>
        i?.id === timer.item_id ||
        String(i?.id) === String(timer.item_id) ||
        i?.id == timer.item_id
    ) || null
  );
}

/** True for planned/auto Q&A secondary timers (not Op Timer, not plain indented ALT). */
export function isQaSecondaryTimer(
  timer: SecondaryTimerLike | null | undefined,
  scheduleItems?: any[] | null
): boolean {
  if (!timer) return false;
  if (timer.source === 'operator' || timer.timer_id === 'OPERATOR' || timer.timerId === 'OPERATOR') {
    return false;
  }
  if (timer.qaIsAutoQa === true) return true;

  const tid = String(timer.timer_id || timer.timerId || '')
    .trim()
    .toUpperCase();
  if (tid === 'QA' || /(^|[^A-Z])QA([^A-Z]|$)/.test(tid) || tid.endsWith('-QA') || tid.endsWith('_QA')) {
    return true;
  }

  const programType = String(timer.programType || timer.program_type || '').trim();
  if (/q\s*&\s*a/i.test(programType) || /^qa$/i.test(programType)) return true;

  const cueRaw = String(timer.cue_display || timer.cue || timer.cue_is || '').trim();
  const cueNorm = cueRaw.replace(/^CUE\s*/i, '').replace(/\s+/g, '');
  if (cueNorm && /Q$/i.test(cueNorm)) return true;

  const item = findScheduleItemForTimer(timer, scheduleItems);
  if (!item) return false;
  if (item.qaIsAutoQa === true) return true;
  const itemPt = String(item.programType || item.program_type || '').trim();
  if (/q\s*&\s*a/i.test(itemPt) || /^qa$/i.test(itemPt)) return true;
  const itemCue = String(item?.customFields?.cue || item?.cue || '').trim();
  const itemCueNorm = itemCue.replace(/^CUE\s*/i, '').replace(/\s+/g, '');
  if (itemCueNorm && /Q$/i.test(itemCueNorm)) return true;
  return false;
}

/** Compact badge text for secondary timer slot. */
export function getSecondaryTimerBadgeText(
  timer: SecondaryTimerLike | null | undefined,
  scheduleItems?: any[] | null
): string {
  return isQaSecondaryTimer(timer, scheduleItems) ? 'Q&A Timer' : 'ALT';
}

function normalizeCueLabel(raw: string, itemId?: number | string | null): string {
  let cue = String(raw || '').trim();
  if (!cue && itemId != null && itemId !== '') {
    cue = `CUE ${itemId}`;
  }
  if (cue) {
    if (!/^CUE\b/i.test(cue)) {
      cue = `CUE ${cue}`;
    }
    cue = cue.replace(/CUE\s*(\d+)/i, 'CUE $1');
  } else {
    cue = 'CUE';
  }
  return cue;
}

function resolveSegmentName(
  timer: {
    segment_name?: string | null;
    segmentName?: string | null;
    item_id?: number | string | null;
  } | null | undefined,
  scheduleItems?: any[] | null
): string {
  const direct = String(timer?.segment_name || timer?.segmentName || '').trim();
  if (direct) return direct;

  if (!scheduleItems?.length || timer?.item_id == null) return '';

  const item = scheduleItems.find(
    (i: any) =>
      i?.id === timer.item_id ||
      String(i?.id) === String(timer.item_id) ||
      i?.id == timer.item_id
  );
  return String(item?.segmentName || item?.segment_name || item?.segment || '').trim();
}

export function getAltTimerParts(
  timer: SecondaryTimerLike | null | undefined,
  scheduleItems?: any[] | null
): AltTimerParts {
  if (!timer) return { cueLabel: 'CUE', segment: '' };

  // Operator countdown uses the same ALT badge slot — don't force a "CUE" prefix.
  if (timer.source === 'operator' || timer.timer_id === 'OPERATOR' || timer.timerId === 'OPERATOR') {
    const label = String(timer.cue_display || timer.cue || 'Operator Timer').trim();
    return { cueLabel: label || 'Operator Timer', segment: '' };
  }

  const cueLabel = normalizeCueLabel(
    String(timer.cue_display || timer.cue || timer.cue_is || ''),
    timer.item_id
  );
  const segment = resolveSegmentName(timer, scheduleItems);
  return { cueLabel, segment };
}

/** Plain-text fallback (e.g. status logs). Prefer badge UI on displays. */
export function formatAltTimerLabel(
  timer: Parameters<typeof getAltTimerParts>[0],
  options?: {
    statusPrefix?: string;
    resolumeSuffix?: string;
    scheduleItems?: any[] | null;
  }
): string {
  const { cueLabel, segment } = getAltTimerParts(timer, options?.scheduleItems);
  const core = segment ? `${cueLabel} - ${segment}` : cueLabel;
  if (options?.statusPrefix) {
    return `${options.statusPrefix}${core}`;
  }
  return `${core}${options?.resolumeSuffix || ''}`;
}
