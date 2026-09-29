import React from 'react';

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
  calculateStartTime?: (index: number) => string | number;
  calculateStartTimeWithOvertime?: (index: number) => string | number;
  /** Extra class on the outer cell (e.g. side-column row bg). */
  className?: string;
  style?: React.CSSProperties;
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
  calculateStartTime,
  calculateStartTimeWithOvertime,
  className = '',
  style,
}) => {
  const scheduledStart = calculateStartTime ? String(calculateStartTime(index)) : null;
  const displayedStart = calculateStartTimeWithOvertime
    ? String(calculateStartTimeWithOvertime(index))
    : null;
  const wasStart =
    lockedStartTime && String(lockedStartTime).trim()
      ? String(lockedStartTime).trim()
      : scheduledStart;
  const startTimeRolled =
    !isIndented &&
    showMode === 'in-show' &&
    wasStart &&
    displayedStart &&
    wasStart !== displayedStart;

  const primaryLabel =
    calculateStartTime && calculateStartTimeWithOvertime
      ? String(
          showMode === 'rehearsal' ? calculateStartTime(index) : calculateStartTimeWithOvertime(index)
        ) || (isIndented ? '↘' : '')
      : isIndented
        ? '↘'
        : calculateStartTimeWithOvertime
          ? String(calculateStartTimeWithOvertime(index))
          : String(index + 1);

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
      className={`px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 ${className}`}
      style={{ width, ...style }}
    >
      <div className="flex flex-col items-center gap-1">
        <span className="text-white font-mono text-base font-bold">{primaryLabel}</span>
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
