import { wallClockLabelToMinutes } from './eventLocalClock';

export type StartTimeKind = 'est' | 'ran' | null;

export type StartTimeStatus = {
  clockLabel: string;
  timeKind: StartTimeKind;
  wasLabel: string;
  showWas: boolean;
  ranVsWasMinutes: number | null;
  /** Displayed clock (ran or est) minus was — what the team reads on the badge. */
  clockVsWasMinutes: number | null;
};

export function minutesBetweenClockLabels(a?: string | null, b?: string | null): number | null {
  const left = wallClockLabelToMinutes(String(a || '').trim());
  const right = wallClockLabelToMinutes(String(b || '').trim());
  if (left == null || right == null) return null;
  let diff = left - right;
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff;
}

export function formatOffsetMinutes(minutes: number, lateEarly = false): string {
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  const timeDisplay = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  if (minutes > 0) return lateEarly ? `+${timeDisplay} late` : `+${timeDisplay}`;
  if (minutes < 0) return lateEarly ? `-${timeDisplay} early` : `-${timeDisplay}`;
  return lateEarly ? 'On time' : '0m';
}

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
  const clockVsWasMinutes = minutesBetweenClockLabels(clockLabel, wasLabel);
  const ranVsWasMinutes = hasRan ? clockVsWasMinutes : null;
  return { clockLabel, timeKind, wasLabel, showWas, ranVsWasMinutes, clockVsWasMinutes };
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
