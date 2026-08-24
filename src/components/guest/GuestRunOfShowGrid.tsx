import React, { useCallback, useMemo } from 'react';
import ScheduleRow from '../../pages/ScheduleRow';
import type { GuestScheduleItem } from '../../lib/eventGuestLinks';
import {
  buildIndentedLookup,
  displaySpeakersText,
  estimateRowHeightRem,
  cueFieldValue,
  GUEST_COLUMN_WIDTHS,
  GUEST_VISIBLE_COLUMNS,
  noop,
  ROS_PROGRAM_TYPES,
  ROS_PROGRAM_TYPE_COLORS,
  ROS_SHOT_TYPES,
  toScheduleRowItem,
} from '../../lib/guestRosHelpers';
import { findParentScheduleIndex, isIndentedScheduleItem } from '../../lib/scheduleStartTime';

function dayStartFor(
  day: number,
  masterStartTime?: string,
  dayStartTimes?: Record<number | string, string>
): string {
  if (dayStartTimes) {
    const keyed = dayStartTimes[day] ?? dayStartTimes[String(day)];
    if (keyed) return keyed;
  }
  return masterStartTime || '';
}

function guestRowClass(
  itemId: number,
  index: number,
  activeItemId: number | null | undefined,
  timerRunning: boolean,
  timerLoaded: boolean
): string {
  const isLive = activeItemId != null && itemId === activeItemId;
  if (isLive && timerRunning) return 'bg-green-950';
  if (isLive && timerLoaded) return 'bg-blue-950';
  return index % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900';
}

export interface GuestRunOfShowGridProps {
  schedule: GuestScheduleItem[];
  filteredItems: GuestScheduleItem[];
  masterStartTime?: string;
  dayStartTimes?: Record<number | string, string>;
  activeItemId?: number | null;
  timerRunning?: boolean;
  timerLoaded?: boolean;
  onOpenSpeakers: (itemId: number) => void;
}

const GuestRunOfShowGrid: React.FC<GuestRunOfShowGridProps> = ({
  schedule,
  filteredItems,
  masterStartTime,
  dayStartTimes,
  activeItemId,
  timerRunning = false,
  timerLoaded = false,
  onOpenSpeakers,
}) => {
  const scheduleRows = useMemo(() => schedule.map(toScheduleRowItem), [schedule]);
  const indentedCues = useMemo(() => buildIndentedLookup(schedule), [schedule]);

  const calculateStartTime = useCallback(
    (index: number): string => {
      const indentedLookup = buildIndentedLookup(schedule);
      const calcAt = (idx: number): string => {
        const current = schedule[idx];
        if (!current) return '';

        if (isIndentedScheduleItem(current, indentedLookup)) {
          const parentIndex = findParentScheduleIndex(schedule, idx, indentedLookup);
          if (parentIndex < 0) return '';
          return calcAt(parentIndex);
        }

        const itemDay = current.day || 1;
        const startTime = dayStartFor(itemDay, masterStartTime, dayStartTimes);
        if (!startTime) return '';

        let totalSeconds = 0;
        for (let i = 0; i < idx; i++) {
          const item = schedule[i];
          if ((item.day || 1) === itemDay && !isIndentedScheduleItem(item, indentedLookup)) {
            totalSeconds +=
              (Number(item.durationHours) || 0) * 3600 +
              (Number(item.durationMinutes) || 0) * 60 +
              (Number(item.durationSeconds) || 0);
          }
        }

        const [hours, minutes] = startTime.split(':').map(Number);
        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return '';
        const totalStartSeconds = hours * 3600 + minutes * 60 + totalSeconds;
        const finalHours = Math.floor(totalStartSeconds / 3600) % 24;
        const finalMinutes = Math.floor((totalStartSeconds % 3600) / 60);
        const date = new Date();
        date.setHours(finalHours, finalMinutes, 0, 0);
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      };
      return calcAt(index);
    },
    [schedule, masterStartTime, dayStartTimes]
  );

  const getRowHeight = useCallback(
    (
      notes: string,
      speakersText?: string,
      participants?: string,
      customFields?: unknown,
      customColumns?: unknown[],
      voCueCount?: number
    ) =>
      estimateRowHeightRem(
        notes,
        speakersText,
        participants,
        customFields,
        customColumns,
        voCueCount
      ),
    []
  );

  const getSpeakersHeight = useCallback(
    (speakersText?: string) => estimateRowHeightRem('', speakersText),
    []
  );

  const rowHeightStyle = (item: GuestScheduleItem): React.CSSProperties => ({
    minHeight: getRowHeight(item.notes || '', item.speakersText),
  });

  if (filteredItems.length === 0) {
    return (
      <div className="h-24 flex items-center justify-center text-slate-500 text-xl bg-slate-900 rounded-lg border border-slate-600">
        No schedule items for this day.
      </div>
    );
  }

  const headerCell = 'h-24 bg-slate-700 border-b-3 border-slate-600 flex items-center justify-center flex-shrink-0';

  return (
    <div className="bg-slate-800 rounded-xl p-3 sm:p-4 shadow-2xl flex flex-col min-h-0 flex-1">
      <div
        id="guest-schedule-scroll"
        className="flex-1 min-h-0 overflow-auto rounded-lg border-2 border-slate-600"
        style={{ scrollbarWidth: 'thin' }}
      >
        <div className="flex min-w-max bg-slate-900">
          {/* Row numbers — sticky left */}
          <div className="sticky left-0 z-20 w-12 flex-shrink-0 bg-slate-900 border-r-2 border-slate-600">
            <div className={`${headerCell} sticky top-0 z-30`}>
              <span className="text-white font-bold text-xs">#</span>
            </div>
            {filteredItems.map((item, index) => (
              <div
                key={`num-${item.id}`}
                className={`border-b-2 border-slate-600 flex items-center justify-center text-sm font-bold text-slate-400 ${guestRowClass(
                  item.id,
                  index,
                  activeItemId,
                  timerRunning,
                  timerLoaded
                )}`}
                style={rowHeightStyle(item)}
              >
                {index + 1}
              </div>
            ))}
          </div>

          {/* CUE column — sticky left */}
          <div
            className="sticky left-12 z-20 w-40 flex-shrink-0 bg-slate-900"
            style={{ borderRight: '6px solid #475569' }}
          >
            <div className={`${headerCell} sticky top-0 z-30`}>
              <span className="text-white font-bold text-lg">CUE</span>
            </div>
            {filteredItems.map((item, index) => {
              const rowItem = toScheduleRowItem(item);
              const cueVal = cueFieldValue(String((rowItem.customFields as { cue?: string })?.cue || ''));
              return (
                <div
                  key={`cue-${item.id}`}
                  className={`border-b-2 border-slate-600 flex flex-col items-center justify-center gap-1 px-2 ${guestRowClass(
                    item.id,
                    index,
                    activeItemId,
                    timerRunning,
                    timerLoaded
                  )}`}
                  style={rowHeightStyle(item)}
                >
                  <div className="flex w-full max-w-[9rem]">
                    <div className="flex items-center px-1 py-1 border border-slate-600 border-r-0 rounded-l text-white text-sm font-medium bg-slate-600">
                      CUE
                    </div>
                    <div
                      className="flex-1 px-2 py-1 border border-slate-600 rounded-r text-white text-sm font-bold bg-slate-700 text-center truncate"
                      title={cueVal || '—'}
                    >
                      {cueVal || '—'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Main schedule columns */}
          <div className="flex-shrink-0">
            <div className={`${headerCell} sticky top-0 z-30 flex min-w-max`}>
              {GUEST_VISIBLE_COLUMNS.start && (
                <div
                  className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 h-full"
                  style={{ width: GUEST_COLUMN_WIDTHS.start }}
                >
                  <span className="text-white font-bold">Start</span>
                </div>
              )}
              {GUEST_VISIBLE_COLUMNS.programType && (
                <div
                  className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 h-full"
                  style={{ width: GUEST_COLUMN_WIDTHS.programType }}
                >
                  <span className="text-white font-bold">Program Type</span>
                </div>
              )}
              {GUEST_VISIBLE_COLUMNS.duration && (
                <div
                  className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 h-full"
                  style={{ width: GUEST_COLUMN_WIDTHS.duration }}
                >
                  <div className="text-center">
                    <div className="text-white font-bold">Duration</div>
                    <div className="text-xs text-slate-400">HH MM SS</div>
                  </div>
                </div>
              )}
              {GUEST_VISIBLE_COLUMNS.segmentName && (
                <div
                  className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 h-full"
                  style={{ width: GUEST_COLUMN_WIDTHS.segmentName }}
                >
                  <span className="text-white font-bold">Segment Name</span>
                </div>
              )}
              {GUEST_VISIBLE_COLUMNS.shotType && (
                <div
                  className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 h-full"
                  style={{ width: GUEST_COLUMN_WIDTHS.shotType }}
                >
                  <span className="text-white font-bold">Shot Type</span>
                </div>
              )}
              {GUEST_VISIBLE_COLUMNS.pptQA && (
                <div
                  className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 h-full"
                  style={{ width: GUEST_COLUMN_WIDTHS.pptQA }}
                >
                  <span className="text-white font-bold">PPT/Q&A</span>
                </div>
              )}
              {GUEST_VISIBLE_COLUMNS.notes && (
                <div
                  className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 h-full"
                  style={{ width: GUEST_COLUMN_WIDTHS.notes }}
                >
                  <span className="text-white font-bold">Notes</span>
                </div>
              )}
              {GUEST_VISIBLE_COLUMNS.speakers && (
                <div
                  className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 h-full"
                  style={{ width: GUEST_COLUMN_WIDTHS.speakers }}
                >
                  <span className="text-white font-bold">Speakers</span>
                </div>
              )}
            </div>

            {filteredItems.map((item, index) => {
              const originalIndex = schedule.findIndex((s) => s.id === item.id);
              const rowIndex = originalIndex >= 0 ? originalIndex : index;
              const rowItem = scheduleRows[rowIndex] || toScheduleRowItem(item);

              return (
                <div
                  key={item.id}
                  data-item-id={item.id}
                  className={`border-b-2 border-slate-600 flex relative ${guestRowClass(
                    item.id,
                    index,
                    activeItemId,
                    timerRunning,
                    timerLoaded
                  )}`}
                  style={{
                    ...rowHeightStyle(item),
                    textDecoration: item.programType === 'KILLED' ? 'line-through' : 'none',
                    color: item.programType === 'KILLED' ? '#9CA3AF' : 'inherit',
                  }}
                >
                  <ScheduleRow
                    asFragment
                    item={rowItem}
                    index={rowIndex}
                    columnWidths={GUEST_COLUMN_WIDTHS}
                    visibleColumns={GUEST_VISIBLE_COLUMNS}
                    indentedCues={indentedCues}
                    overtimeMinutes={{}}
                    startCueId={null}
                    showStartOvertime={0}
                    cumulativeOvertime={0}
                    programTypes={ROS_PROGRAM_TYPES}
                    programTypeColors={ROS_PROGRAM_TYPE_COLORS}
                    shotTypes={ROS_SHOT_TYPES}
                    currentUserRole="VIEWER"
                    setSchedule={noop}
                    handleUserEditing={noop}
                    handleModalEditing={noop}
                    handleModalClosed={noop}
                    logChangeDebounced={noop}
                    calculateStartTime={calculateStartTime}
                    calculateStartTimeWithOvertime={calculateStartTime}
                    showMode="rehearsal"
                    displaySpeakersText={displaySpeakersText}
                    getRowHeight={getRowHeight}
                    getSpeakersHeight={getSpeakersHeight}
                    setViewingSpeakersItem={(id: number) => onOpenSpeakers(id)}
                    setShowViewSpeakersModal={noop}
                    customColumns={[]}
                    visibleCustomColumns={{}}
                    customColumnWidths={{}}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GuestRunOfShowGrid;
