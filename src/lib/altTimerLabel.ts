/**
 * Secondary / sub-cue timer label parts for Clock & Fullscreen.
 * UI shows a compact "ALT" badge + "CUE # - Segment Name" (not the words "Alt Timer").
 */

export type AltTimerParts = {
  cueLabel: string;
  segment: string;
};

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
  timer: {
    cue_display?: string | null;
    cue?: string | null;
    cue_is?: string | null;
    item_id?: number | string | null;
    segment_name?: string | null;
    segmentName?: string | null;
  } | null | undefined,
  scheduleItems?: any[] | null
): AltTimerParts {
  if (!timer) return { cueLabel: 'CUE', segment: '' };

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
