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
import {
  GUEST_COLUMN_LABELS,
  GUEST_STICKY_CUE_WIDTH_PX,
  GUEST_STICKY_NUM_WIDTH_PX,
  GUEST_STICKY_START_LEFT_PX,
  guestColumnFlexOrderMap,
  normalizeGuestColumnOrder,
  type GuestScrollColumn,
  type GuestVisibleColumns,
} from '../../lib/guestColumnPrefs';
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
  visibleColumns?: GuestVisibleColumns;
  /** When true, Start sticks beside CUE (outside horizontal scroll). */
  stickyStartColumn?: boolean;
  columnOrder?: GuestScrollColumn[];
  onOpenSpeakers: (itemId: number) => void;
  onViewSegmentDetail?: (itemId: number) => void;
}

/**
 * One flex row per cue — # / CUE (and optional Start) stick left and stretch
 * with notes/speakers the same way Run of Show keeps side columns aligned.
 */
const GuestRunOfShowGrid: React.FC<GuestRunOfShowGridProps> = ({
  schedule,
  filteredItems,
  masterStartTime,
  dayStartTimes,
  activeItemId,
  timerRunning = false,
  timerLoaded = false,
  visibleColumns = GUEST_VISIBLE_COLUMNS,
  stickyStartColumn = false,
  columnOrder,
  onOpenSpeakers,
  onViewSegmentDetail,
}) => {
  const columns = visibleColumns || GUEST_VISIBLE_COLUMNS;
  const startPinnedBesideCue = stickyStartColumn && columns.start;
  const scrollColumns = useMemo(
    () => (startPinnedBesideCue ? { ...columns, start: false } : columns),
    [startPinnedBesideCue, columns]
  );
  const orderedKeys = useMemo(
    () => normalizeGuestColumnOrder(columnOrder || null),
    [columnOrder]
  );
  const columnFlexOrder = useMemo(() => guestColumnFlexOrderMap(orderedKeys), [orderedKeys]);

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
        voCueCount,
        GUEST_COLUMN_WIDTHS.notes
      ),
    []
  );

  const getSpeakersHeight = useCallback(
    (speakersText?: string) =>
      estimateRowHeightRem('', speakersText, undefined, undefined, undefined, 0, GUEST_COLUMN_WIDTHS.notes),
    []
  );

  const headerCell =
    'h-24 bg-slate-700 border-b-3 border-slate-600 flex items-center justify-center flex-shrink-0';

  const renderScrollHeader = (key: GuestScrollColumn) => {
    if (key === 'start' && startPinnedBesideCue) return null;
    if (!scrollColumns[key]) return null;
    const width = GUEST_COLUMN_WIDTHS[key as keyof typeof GUEST_COLUMN_WIDTHS];
    return (
      <div
        key={key}
        className={`${headerCell} px-4 border-r border-slate-600`}
        style={{ width, order: columnFlexOrder[key] ?? 999 }}
      >
        {key === 'duration' ? (
          <div className="text-center">
            <div className="text-white font-bold">{GUEST_COLUMN_LABELS[key]}</div>
            <div className="text-xs text-slate-400">HH MM SS</div>
          </div>
        ) : (
          <span className="text-white font-bold">
            {key === 'programType'
              ? 'Program Type'
              : key === 'segmentName'
                ? 'Segment Name'
                : key === 'shotType'
                  ? 'Shot Type'
                  : GUEST_COLUMN_LABELS[key]}
          </span>
        )}
      </div>
    );
  };

  if (filteredItems.length === 0) {
    return (
      <div className="h-24 flex items-center justify-center text-slate-500 text-xl bg-slate-900 rounded-lg border border-slate-600">
        No schedule items for this day.
      </div>
    );
  }

  return (
    <div className="bg-slate-800 rounded-xl p-3 sm:p-4 shadow-2xl flex flex-col min-h-0 flex-1 h-full">
      <div
        id="guest-schedule-scroll"
        className="flex-1 min-h-0 overflow-auto rounded-lg border-2 border-slate-600"
        style={{ scrollbarWidth: 'thin' }}
      >
        <div className="min-w-max bg-slate-900">
          {/* Sticky header — same row structure as data rows */}
          <div className="flex sticky top-0 z-30 min-w-max">
            <div
              className={`${headerCell} sticky left-0 z-40 border-r-2 border-slate-600`}
              style={{ width: GUEST_STICKY_NUM_WIDTH_PX }}
            >
              <span className="text-white font-bold text-xs">#</span>
            </div>
            <div
              className={`${headerCell} sticky z-40`}
              style={{
                left: GUEST_STICKY_NUM_WIDTH_PX,
                width: GUEST_STICKY_CUE_WIDTH_PX,
                borderRight: startPinnedBesideCue ? '1px solid #475569' : '6px solid #475569',
              }}
            >
              <span className="text-white font-bold text-lg">CUE</span>
            </div>
            {startPinnedBesideCue && (
              <div
                className={`${headerCell} sticky z-40 px-2`}
                style={{
                  left: GUEST_STICKY_START_LEFT_PX,
                  width: GUEST_COLUMN_WIDTHS.start,
                  borderRight: '6px solid #475569',
                }}
              >
                <span className="text-white font-bold">Start</span>
              </div>
            )}
            {orderedKeys.map((key) => renderScrollHeader(key))}
          </div>

          {/* Data rows — # / CUE / optional Start are siblings of ScheduleRow cells */}
          {filteredItems.map((item, index) => {
            const originalIndex = schedule.findIndex((s) => s.id === item.id);
            const rowIndex = originalIndex >= 0 ? originalIndex : index;
            const rowItem = scheduleRows[rowIndex] || toScheduleRowItem(item);
            const cueVal = cueFieldValue(
              String((rowItem.customFields as { cue?: string })?.cue || item.cue || '')
            );
            const rowBg = guestRowClass(item.id, index, activeItemId, timerRunning, timerLoaded);
            const minH = estimateRowHeightRem(
              item.notes || '',
              item.speakersText,
              item.speakers,
              undefined,
              undefined,
              0,
              GUEST_COLUMN_WIDTHS.notes
            );
            const isIndented = Boolean(indentedCues[item.id] || item.isIndented);
            const startLabel = calculateStartTime(rowIndex) || (isIndented ? '↘' : '—');

            return (
              <div
                key={item.id}
                data-item-id={item.id}
                className={`flex items-stretch border-b-2 border-slate-600 relative min-w-max ${rowBg}`}
                style={{
                  minHeight: minH,
                  textDecoration: item.programType === 'KILLED' ? 'line-through' : 'none',
                  color: item.programType === 'KILLED' ? '#9CA3AF' : 'inherit',
                }}
              >
                <div
                  className={`sticky left-0 z-20 flex-shrink-0 border-r-2 border-slate-600 flex items-center justify-center text-sm font-bold text-slate-400 ${rowBg}`}
                  style={{ width: GUEST_STICKY_NUM_WIDTH_PX }}
                >
                  {index + 1}
                </div>
                <div
                  className={`sticky z-20 flex-shrink-0 flex flex-col items-center justify-center gap-1 px-2 ${rowBg}`}
                  style={{
                    left: GUEST_STICKY_NUM_WIDTH_PX,
                    width: GUEST_STICKY_CUE_WIDTH_PX,
                    borderRight: startPinnedBesideCue ? '1px solid #475569' : '6px solid #475569',
                  }}
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
                {startPinnedBesideCue && (
                  <div
                    className={`sticky z-20 flex-shrink-0 flex items-center justify-center px-2 ${rowBg}`}
                    style={{
                      left: GUEST_STICKY_START_LEFT_PX,
                      width: GUEST_COLUMN_WIDTHS.start,
                      borderRight: '6px solid #475569',
                    }}
                  >
                    <span className="text-white font-mono text-base font-bold">{startLabel}</span>
                  </div>
                )}
                <ScheduleRow
                  asFragment
                  item={rowItem}
                  index={rowIndex}
                  columnWidths={GUEST_COLUMN_WIDTHS}
                  visibleColumns={scrollColumns}
                  columnFlexOrder={columnFlexOrder}
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
                  onViewSegmentDetail={onViewSegmentDetail}
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
  );
};

export default GuestRunOfShowGrid;
