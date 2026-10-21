import React from 'react';
import { wallClockLabelToMinutes } from '../lib/eventLocalClock';

export type StartTimeColumnCellProps = {
  itemId: number;
  index: number;
  width: number;
  isIndented: boolean;
  showMode?: 'rehearsal' | 'in-show';
  overtimeMinutes: Record<number, number>;
  startCueId: number | null;
  showStartOvertime: number;
  cumulativeOvertime: number;
  lockedStartTime?: string | null;
  /** In-Show: wall-clock time this cue actually started running (same format as Start). */
  actualStartLabel?: string | null;
  calculateStartTime?: (index: number) => string | number;
  calculateStartTimeWithOvertime?: (index: number) => string | number;
  /** Extra class on the outer cell (e.g. side-column row bg). */
  className?: string;
  style?: React.CSSProperties;
  /** Timed marker: click Start to edit time / mode. */
  isTimedMarker?: boolean;
  /** absolute = fixed clock; offset = follows parent OT */
  markerTimeMode?: 'absolute' | 'offset';
  onEditTimedMarker?: () => void;
};

/**
 * Start time display for ROS — used in the scrollable grid and when pinned beside CUE.
 */
const StartTimeColumnCell: React.FC<StartTimeColumnCellProps> = ({
  itemId,
  index,
  width,
  isIndented,
  showMode,
  overtimeMinutes,
  startCueId,
  showStartOvertime,
  cumulativeOvertime,
  lockedStartTime,
  actualStartLabel,
  calculateStartTime,
  calculateStartTimeWithOvertime,
  className = '',
  style,
  isTimedMarker = false,
  markerTimeMode = 'offset',
  onEditTimedMarker,
}) => {
  const scheduledStart = calculateStartTime ? String(calculateStartTime(index)) : null;
  const wasStart =
    lockedStartTime && String(lockedStartTime).trim()
      ? String(lockedStartTime).trim()
      : scheduledStart;
  const hasRan = !isIndented && showMode === 'in-show' && !!actualStartLabel;
  const clockLabel = hasRan
    ? actualStartLabel!
    : calculateStartTime && calculateStartTimeWithOvertime
      ? String(
          showMode === 'rehearsal' ? calculateStartTime(index) : calculateStartTimeWithOvertime(index)
        ) || (isIndented ? '↘' : '')
      : isIndented
        ? '↘'
        : calculateStartTimeWithOvertime
          ? String(calculateStartTimeWithOvertime(index))
          : String(index + 1);
  const startTimeRolled =
    !isIndented &&
    showMode === 'in-show' &&
    !!wasStart &&
    !!clockLabel &&
    wasStart !== clockLabel;
  /** Upcoming adjusted Start is an estimate; once the cue starts we swap est → ran. */
  const timeKind: 'est' | 'ran' | null = hasRan ? 'ran' : startTimeRolled ? 'est' : null;
  const actualVsWasMinutes = (() => {
    if (!hasRan || !wasStart) return null;
    const ran = wallClockLabelToMinutes(actualStartLabel!);
    const was = wallClockLabelToMinutes(wasStart);
    if (ran == null || was == null) return null;
    let diff = ran - was;
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    return diff;
  })();
  const primaryLabel = clockLabel;

  const showOtBadge =
    !isIndented &&
    showMode !== 'rehearsal' &&
    (overtimeMinutes[itemId] ||
      (itemId === startCueId && showStartOvertime !== 0) ||
      (calculateStartTime &&
        calculateStartTimeWithOvertime &&
        String(calculateStartTime(index)) !== String(calculateStartTimeWithOvertime(index))));

  return (
    <div
      className={`px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 ${className} ${
        isTimedMarker && onEditTimedMarker ? 'cursor-pointer hover:bg-sky-950/40' : ''
      }`}
      style={{ width, ...style }}
      onClick={isTimedMarker && onEditTimedMarker ? onEditTimedMarker : undefined}
      title={
        isTimedMarker
          ? markerTimeMode === 'absolute'
            ? 'Absolute timed marker — fixed clock time (does not move with parent overtime). Click to edit.'
            : 'Offset timed marker — relative to parent (slides with parent overtime). Click to edit.'
          : undefined
      }
    >
      <div className="flex flex-col items-center gap-1">
        <span
          className={`font-mono text-base font-bold ${
            isTimedMarker
              ? 'text-sky-300'
              : timeKind === 'ran'
                ? actualVsWasMinutes == null
                  ? 'text-white'
                  : actualVsWasMinutes > 0
                    ? 'text-red-400'
                    : 'text-green-400'
                : 'text-white'
          }`}
        >
          {timeKind ? (
            <span
              className={`mr-1.5 align-middle text-[10px] font-semibold uppercase tracking-wide ${
                timeKind === 'ran' ? 'text-current' : 'text-amber-400'
              }`}
              title={
                timeKind === 'ran'
                  ? 'When this cue actually started running'
                  : 'Projected Start — updates from the live cue'
              }
            >
              {timeKind}
            </span>
          ) : null}
          {primaryLabel}
        </span>
        {isTimedMarker ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-400/90">
            {markerTimeMode === 'absolute' ? 'abs' : 'offset'}
          </span>
        ) : null}
        {startTimeRolled && wasStart && (
          <span className="text-xs text-slate-400">was {wasStart}</span>
        )}
        {showOtBadge && (
          <span
            className={`text-sm font-bold px-2 py-1 rounded text-center leading-tight ${(() => {
              if (itemId === startCueId) {
                return showStartOvertime > 0
                  ? 'text-red-400 bg-red-900/30'
                  : 'text-green-400 bg-green-900/30';
              }
              return cumulativeOvertime > 0
                ? 'text-red-400 bg-red-900/30'
                : 'text-green-400 bg-green-900/30';
            })()}`}
            title="Time adjusted due to overtime"
          >
            {(() => {
              if (itemId === startCueId) {
                const showStartOT = showStartOvertime || 0;
                if (showStartOT > 0) {
                  const hours = Math.floor(showStartOT / 60);
                  const minutes = showStartOT % 60;
                  const timeDisplay = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
                  return `+${timeDisplay} late`;
                }
                if (showStartOT < 0) {
                  const hours = Math.floor(Math.abs(showStartOT) / 60);
                  const minutes = Math.abs(showStartOT) % 60;
                  const timeDisplay = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
                  return `-${timeDisplay} early`;
                }
                return 'On time';
              }
              if (cumulativeOvertime > 0) {
                const hours = Math.floor(cumulativeOvertime / 60);
                const minutes = cumulativeOvertime % 60;
                const timeDisplay = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
                return `+${timeDisplay}`;
              }
              if (cumulativeOvertime < 0) {
                const hours = Math.floor(Math.abs(cumulativeOvertime) / 60);
                const minutes = Math.abs(cumulativeOvertime) % 60;
                const timeDisplay = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
                return `-${timeDisplay}`;
              }
              return '0m';
            })()}
          </span>
        )}
      </div>
    </div>
  );
};

export default StartTimeColumnCell;
