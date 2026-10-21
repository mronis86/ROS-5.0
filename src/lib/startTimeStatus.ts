import { wallClockLabelToMinutes } from './eventLocalClock';

export type StartTimeKind = 'est' | 'ran' | null;

export type StartTimeStatus = {
  clockLabel: string;
  timeKind: StartTimeKind;
  wasLabel: string;
  showWas: boolean;
  ranVsWasMinutes: number | null;
};

/** Same est / ran / was rules as the ROS Start column. */
export function resolveStartTimeStatus(opts: {
  isIndented?: boolean;
  showMode?: 'rehearsal' | 'in-show';
  projectedLabel?: string | null;
  wasLabel?: string | null;
  actualLabel?: string | null;
}): StartTimeStatus {
  const wasLabel = String(opts.wasLabel || '').trim();
  const projected = String(opts.projectedLabel || '').trim();
  const actual = String(opts.actualLabel || '').trim();
  const hasRan = !opts.isIndented && opts.showMode === 'in-show' && !!actual;
  const clockLabel = hasRan ? actual : projected;
  const showWas =
    !opts.isIndented &&
    opts.showMode === 'in-show' &&
    !!wasLabel &&
    !!clockLabel &&
    wasLabel !== clockLabel;
  const timeKind: StartTimeKind = hasRan ? 'ran' : showWas ? 'est' : null;
  let ranVsWasMinutes: number | null = null;
  if (hasRan && wasLabel) {
    const ran = wallClockLabelToMinutes(actual);
    const was = wallClockLabelToMinutes(wasLabel);
    if (ran != null && was != null) {
      let diff = ran - was;
      if (diff > 720) diff -= 1440;
      if (diff < -720) diff += 1440;
      ranVsWasMinutes = diff;
    }
  }
  return { clockLabel, timeKind, wasLabel, showWas, ranVsWasMinutes };
}

export function startTimeKindClass(kind: StartTimeKind, ranVsWasMinutes?: number | null): string {
  if (kind === 'ran') {
    if (ranVsWasMinutes == null) return 'text-white';
    return ranVsWasMinutes > 0 ? 'text-red-400' : 'text-green-400';
  }
  return 'text-white';
}

export function startTimeKindTagClass(kind: StartTimeKind): string {
  return kind === 'ran' ? 'text-current' : 'text-amber-400';
}
