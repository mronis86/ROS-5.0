/** Start column display: time-of-day with or without seconds. */
export type StartTimeDisplayMode = 'hm' | 'hms';

/** Segment Name column: one truncated line vs wrap to fill the column. */
export type SegmentNameDisplayMode = 'single' | 'wrap';

export function formatScheduleClock(
  totalSeconds: number,
  mode: StartTimeDisplayMode = 'hm'
): string {
  const daySec = ((Math.floor(totalSeconds) % 86400) + 86400) % 86400;
  const h = Math.floor(daySec / 3600);
  const m = Math.floor((daySec % 3600) / 60);
  const s = daySec % 60;
  const date = new Date();
  date.setHours(h, m, s, 0);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(mode === 'hms' ? { second: '2-digit' as const } : {}),
    hour12: true,
  });
}

export function cycleStartTimeDisplayMode(mode: StartTimeDisplayMode): StartTimeDisplayMode {
  return mode === 'hm' ? 'hms' : 'hm';
}

export function cycleSegmentNameDisplayMode(
  mode: SegmentNameDisplayMode
): SegmentNameDisplayMode {
  return mode === 'single' ? 'wrap' : 'single';
}

export function startTimeDisplayModeLabel(mode: StartTimeDisplayMode): string {
  return mode === 'hms' ? 'h:mm:ss' : 'h:mm';
}

export function segmentNameDisplayModeLabel(mode: SegmentNameDisplayMode): string {
  return mode === 'wrap' ? 'multi-line' : 'single-line';
}
