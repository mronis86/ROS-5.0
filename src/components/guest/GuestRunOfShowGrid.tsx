import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  loadGuestSegmentNameDisplayMode,
  normalizeGuestColumnOrderWithCustom,
  persistGuestSegmentNameDisplayMode,
  type GuestScrollColumn,
  type GuestVisibleColumns,
} from '../../lib/guestColumnPrefs';
import {
  cycleSegmentNameDisplayMode,
  segmentNameDisplayModeLabel,
  type SegmentNameDisplayMode,
} from '../../lib/scheduleClockFormat';
import { parseCustomColumnOrderKey } from '../../lib/rosColumnOrder';
import StartTimeColumnCell from '../StartTimeColumnCell';
import DuplicateCueFlag from '../DuplicateCueFlag';
import { buildDuplicateCueMap, duplicateCueTooltip } from '../../lib/cueDisplay';
import {
  calculateScheduleStartTime,
  calculateScheduleStartTimeWithOvertime,
  cumulativeOvertimeMinutesForIndex,
  itemCountsTowardStartTime,
} from '../../lib/scheduleStartTime';
import { computeLiveStartAnchor } from '../../lib/liveStartProjection';
import { eventLocalSecondsOfDay, resolveShowTimezone } from '../../lib/eventLocalClock';
import { formatScheduleClock } from '../../lib/scheduleClockFormat';
import { parseClockToSeconds } from '../../lib/timedMarker';
import type { GuestActiveTimer, GuestStartTiming } from '../../lib/eventGuestLinks';
import { EMPTY_GUEST_START_TIMING } from '../../lib/eventGuestLinks';

export type GuestCustomColumn = { id: string; name: string };

function overtimeMapFromTiming(timing: GuestStartTiming): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [id, mins] of Object.entries(timing.overtimeMinutes || {})) {
    const n = Number(id);
    if (Number.isFinite(n)) out[n] = Number(mins) || 0;
  }
  return out;
}

function lockedMapFromTiming(timing: GuestStartTiming): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [id, label] of Object.entries(timing.lockedStartTimes || {})) {
    const n = Number(id);
    if (Number.isFinite(n) && label) out[n] = String(label);
  }
  return out;
}

function actualStartMsFromTiming(timing: GuestStartTiming): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [id, iso] of Object.entries(timing.cueActualStarts || {})) {
    const n = Number(id);
    const ms = iso ? new Date(iso).getTime() : NaN;
    if (Number.isFinite(n) && Number.isFinite(ms) && new Date(ms).getUTCFullYear() < 2090) {
      out[n] = ms;
    }
  }
  return out;
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
  /** Built-in guest keys and optional `custom:{id}` entries. */
  columnOrder?: string[];
  customColumns?: GuestCustomColumn[];
  visibleCustomColumns?: Record<string, boolean>;
  /** Applied on the scrollport (not an ancestor) so sticky #/CUE/Start still work. */
  zoom?: number;
  /** When true, keep the live cue row in view as the timer advances. */
  followActive?: boolean;
  startTiming?: GuestStartTiming;
  activeTimer?: GuestActiveTimer | null;
  onOpenSpeakers: (itemId: number) => void;
  onViewSegmentDetail?: (itemId: number) => void;
  segmentSpellingMode?: 'off' | 'creative';
  onSegmentSpellingPatch?: (
    itemId: number,
    patch: { segmentSpellingOk?: string[]; segmentSpellingAskRos?: boolean }
  ) => void;
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
  stickyStartColumn = true,
  columnOrder,
  customColumns = [],
  visibleCustomColumns = {},
  zoom,
  followActive = false,
  startTiming,
  activeTimer = null,
  onOpenSpeakers,
  onViewSegmentDetail,
  segmentSpellingMode = 'off',
  onSegmentSpellingPatch,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [segmentNameDisplayMode, setSegmentNameDisplayMode] = useState<SegmentNameDisplayMode>(
    loadGuestSegmentNameDisplayMode
  );
  const toggleSegmentNameDisplayMode = useCallback(() => {
    setSegmentNameDisplayMode((prev) => {
      const next = cycleSegmentNameDisplayMode(prev);
      persistGuestSegmentNameDisplayMode(next);
      return next;
    });
  }, []);
  const columns = visibleColumns || GUEST_VISIBLE_COLUMNS;
  const startPinnedBesideCue = stickyStartColumn && columns.start;
  const scrollColumns = useMemo(
    () => (startPinnedBesideCue ? { ...columns, start: false } : columns),
    [startPinnedBesideCue, columns]
  );
  const customIds = useMemo(() => customColumns.map((c) => c.id), [customColumns]);
  const orderedKeys = useMemo(
    () => normalizeGuestColumnOrderWithCustom(columnOrder || null, customIds),
    [columnOrder, customIds]
  );
  const columnFlexOrder = useMemo(() => guestColumnFlexOrderMap(orderedKeys), [orderedKeys]);
  const duplicateCues = useMemo(() => buildDuplicateCueMap(filteredItems), [filteredItems]);
  const customById = useMemo(() => {
    const map = new Map<string, GuestCustomColumn>();
    for (const col of customColumns) map.set(col.id, col);
    return map;
  }, [customColumns]);

  const scheduleRows = useMemo(() => schedule.map(toScheduleRowItem), [schedule]);
  const indentedCues = useMemo(() => buildIndentedLookup(schedule), [schedule]);
  const timing = startTiming || EMPTY_GUEST_START_TIMING;
  const showMode = timing.showMode === 'in-show' ? 'in-show' : 'rehearsal';
  const overtimeMinutes = useMemo(() => overtimeMapFromTiming(timing), [timing]);
  const lockedStartTimes = useMemo(() => lockedMapFromTiming(timing), [timing]);
  const actualStartMs = useMemo(() => actualStartMsFromTiming(timing), [timing]);
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (showMode !== 'in-show' || !timing.liveStartProjection) return;
    const id = window.setInterval(() => setLiveTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [showMode, timing.liveStartProjection]);

  useEffect(() => {
    if (!followActive || activeItemId == null) return;
    const root = scrollRef.current;
    if (!root) return;
    const row = root.querySelector(`[data-item-id="${activeItemId}"]`) as HTMLElement | null;
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [followActive, activeItemId, filteredItems]);

  const calculateStartTime = useCallback(
    (index: number): string =>
      calculateScheduleStartTime(schedule, index, masterStartTime, dayStartTimes, indentedCues),
    [schedule, masterStartTime, dayStartTimes, indentedCues]
  );

  const liveStartAnchor = useMemo(() => {
    if (showMode !== 'in-show' || !timing.liveStartProjection) return null;
    const running =
      !!activeTimer &&
      (activeTimer.isRunning === true || activeTimer.timerState === 'running') &&
      activeTimer.itemId != null;
    const runningId = running ? Number(activeTimer.itemId) : null;
    const startedMs = running
      ? actualStartMs[runningId as number] ??
        (activeTimer?.startedAt ? new Date(activeTimer.startedAt).getTime() : NaN)
      : NaN;
    const tz = resolveShowTimezone(timing.timezone);
    const anchor = computeLiveStartAnchor({
      schedule,
      countsTowardStart: (row) => itemCountsTowardStartTime(row, indentedCues),
      plannedStartSec: (index) => parseClockToSeconds(calculateStartTime(index)),
      running:
        runningId != null && Number.isFinite(startedMs)
          ? {
              itemId: runningId,
              startedAtMs: startedMs,
              durationSec: Number(activeTimer?.durationSeconds) || 0,
            }
          : null,
      actualStarts: actualStartMs,
      nowMs: Date.now(),
      timeZone: tz,
    });
    if (!anchor) return null;
    const startCueIndex =
      timing.startCueId != null ? schedule.findIndex((s) => s.id === timing.startCueId) : -1;
    if (
      startCueIndex >= 0 &&
      anchor.anchorIndex < startCueIndex &&
      (schedule[startCueIndex].day || 1) === anchor.day
    ) {
      return null;
    }
    return anchor;
  }, [
    showMode,
    timing.liveStartProjection,
    timing.startCueId,
    timing.timezone,
    activeTimer,
    actualStartMs,
    schedule,
    indentedCues,
    calculateStartTime,
    liveTick,
  ]);

  const overtimeOpts = useMemo(
    () => ({
      masterStartTime,
      dayStartTimes,
      indentedLookup: indentedCues,
      overtimeMinutes,
      startCueId: timing.startCueId,
      showStartOvertime: timing.showStartOvertime,
      liveOffsetMinutes: liveStartAnchor?.offsetMinutes ?? null,
      liveAnchorIndex: liveStartAnchor?.anchorIndex ?? null,
      liveAnchorDay: liveStartAnchor?.day ?? null,
    }),
    [
      masterStartTime,
      dayStartTimes,
      indentedCues,
      overtimeMinutes,
      timing.startCueId,
      timing.showStartOvertime,
      liveStartAnchor,
    ]
  );

  const calculateStartTimeWithOvertime = useCallback(
    (index: number): string => calculateScheduleStartTimeWithOvertime(schedule, index, overtimeOpts),
    [schedule, overtimeOpts]
  );

  const actualStartLabels = useMemo(() => {
    const out: Record<number, string> = {};
    if (showMode !== 'in-show') return out;
    const tz = resolveShowTimezone(timing.timezone);
    const add = (id: number, ms: number) => {
      if (!Number.isFinite(id) || !Number.isFinite(ms) || new Date(ms).getUTCFullYear() >= 2090) return;
      out[id] = formatScheduleClock(eventLocalSecondsOfDay(ms, tz));
    };
    for (const [id, ms] of Object.entries(actualStartMs)) add(Number(id), ms);
    if (
      activeTimer &&
      (activeTimer.isRunning === true || activeTimer.timerState === 'running') &&
      activeTimer.startedAt
    ) {
      const liveId = Number(activeTimer.itemId);
      if (!out[liveId]) add(liveId, new Date(activeTimer.startedAt).getTime());
    }
    return out;
  }, [showMode, timing.timezone, actualStartMs, activeTimer]);

  const getRowHeight = useCallback(
    (
      notes: string,
      speakersText?: string,
      participants?: string,
      customFields?: unknown,
      customColumns?: unknown[],
      voCueCount?: number,
      segmentName?: string
    ) =>
      estimateRowHeightRem(
        notes,
        speakersText,
        participants,
        customFields,
        customColumns,
        voCueCount,
        GUEST_COLUMN_WIDTHS.notes,
        segmentName,
        segmentNameDisplayMode,
        GUEST_COLUMN_WIDTHS.segmentName
      ),
    [segmentNameDisplayMode]
  );

  const getSpeakersHeight = useCallback(
    (speakersText?: string) =>
      estimateRowHeightRem('', speakersText, undefined, undefined, undefined, 0, GUEST_COLUMN_WIDTHS.notes),
    []
  );

  const headerCell =
    'h-24 bg-slate-700 border-b-3 border-slate-600 flex items-center justify-center flex-shrink-0';

  const renderScrollHeader = (key: string) => {
    const customId = parseCustomColumnOrderKey(key);
    if (customId) {
      if (visibleCustomColumns[customId] === false) return null;
      const col = customById.get(customId);
      if (!col) return null;
      return (
        <div
          key={key}
          className={`${headerCell} px-4 border-r border-slate-600`}
          style={{ width: 256, order: columnFlexOrder[key] ?? 999 }}
        >
          <span className="text-white font-bold truncate px-1" title={col.name}>
            {col.name}
          </span>
        </div>
      );
    }

    const builtin = key as GuestScrollColumn;
    if (builtin === 'start' && startPinnedBesideCue) return null;
    if (!scrollColumns[builtin]) return null;
    const width = GUEST_COLUMN_WIDTHS[builtin as keyof typeof GUEST_COLUMN_WIDTHS];
    return (
      <div
        key={key}
        className={`${headerCell} px-4 border-r border-slate-600`}
        style={{ width, order: columnFlexOrder[key] ?? 999 }}
      >
        {builtin === 'duration' ? (
          <div className="text-center">
            <div className="text-white font-bold">{GUEST_COLUMN_LABELS[builtin]}</div>
            <div className="text-xs text-slate-400">HH MM SS</div>
          </div>
        ) : builtin === 'segmentName' ? (
          <button
            type="button"
            onClick={toggleSegmentNameDisplayMode}
            className="w-full h-full px-1 text-left cursor-pointer hover:bg-slate-600/80 transition-colors"
            title={`Segment: ${segmentNameDisplayModeLabel(segmentNameDisplayMode)} (click for ${segmentNameDisplayModeLabel(cycleSegmentNameDisplayMode(segmentNameDisplayMode))})`}
          >
            <div className="text-white font-bold">Segment Name</div>
            <div className="text-[10px] text-slate-400">{segmentNameDisplayModeLabel(segmentNameDisplayMode)}</div>
          </button>
        ) : (
          <span className="text-white font-bold">
            {builtin === 'programType'
              ? 'Program Type'
              : builtin === 'shotType'
                ? 'Shot Type'
                : GUEST_COLUMN_LABELS[builtin]}
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
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto rounded-lg border-2 border-slate-600"
        style={{
          scrollbarWidth: 'thin',
          ...(typeof zoom === 'number' && zoom > 0 && zoom !== 1
            ? ({ zoom } as React.CSSProperties)
            : null),
        }}
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
              item.customFields,
              customColumns,
              0,
              GUEST_COLUMN_WIDTHS.notes,
              item.segmentName,
              segmentNameDisplayMode,
              GUEST_COLUMN_WIDTHS.segmentName
            );
            const isIndented = Boolean(indentedCues[item.id] || item.isIndented || item.isTimedMarker);
            const dup = duplicateCues.get(item.id);

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
                    <div
                      className={`flex items-center px-1 py-1 border border-r-0 rounded-l text-white text-sm font-medium ${
                        dup ? 'bg-amber-600 border-amber-400' : 'bg-slate-600 border-slate-600'
                      }`}
                    >
                      CUE
                    </div>
                    <div
                      className={`flex-1 px-2 py-1 border rounded-r text-white text-sm font-bold bg-slate-700 text-center truncate ${
                        dup ? 'border-amber-400' : 'border-slate-600'
                      }`}
                      title={dup ? duplicateCueTooltip(dup.otherRowNumbers) : cueVal || '—'}
                    >
                      {cueVal || '—'}
                    </div>
                  </div>
                  {dup ? <DuplicateCueFlag otherRowNumbers={dup.otherRowNumbers} /> : null}
                </div>
                {startPinnedBesideCue && (
                  <div
                    className={`sticky z-20 flex-shrink-0 flex items-stretch ${rowBg}`}
                    style={{
                      left: GUEST_STICKY_START_LEFT_PX,
                      width: GUEST_COLUMN_WIDTHS.start,
                      borderRight: '6px solid #475569',
                    }}
                  >
                    <StartTimeColumnCell
                      itemId={item.id}
                      index={rowIndex}
                      width={GUEST_COLUMN_WIDTHS.start}
                      isIndented={isIndented}
                      showMode={showMode}
                      overtimeMinutes={overtimeMinutes}
                      startCueId={timing.startCueId}
                      showStartOvertime={timing.showStartOvertime}
                      cumulativeOvertime={cumulativeOvertimeMinutesForIndex(
                        schedule,
                        rowIndex,
                        overtimeOpts
                      )}
                      lockedStartTime={lockedStartTimes[item.id] || null}
                      actualStartLabel={actualStartLabels[item.id] || null}
                      calculateStartTime={calculateStartTime}
                      calculateStartTimeWithOvertime={calculateStartTimeWithOvertime}
                      isTimedMarker={item.isTimedMarker === true}
                      markerTimeMode={item.markerTimeMode === 'absolute' ? 'absolute' : 'offset'}
                      className={`border-r-0 h-full ${rowBg}`}
                    />
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
                  overtimeMinutes={overtimeMinutes}
                  startCueId={timing.startCueId}
                  showStartOvertime={timing.showStartOvertime}
                  cumulativeOvertime={cumulativeOvertimeMinutesForIndex(
                    schedule,
                    rowIndex,
                    overtimeOpts
                  )}
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
                  calculateStartTimeWithOvertime={calculateStartTimeWithOvertime}
                  showMode={showMode}
                  lockedStartTime={lockedStartTimes[item.id] || null}
                  actualStartLabel={actualStartLabels[item.id] || null}
                  displaySpeakersText={displaySpeakersText}
                  getRowHeight={getRowHeight}
                  getSpeakersHeight={getSpeakersHeight}
                  setViewingSpeakersItem={(id: number) => onOpenSpeakers(id)}
                  setShowViewSpeakersModal={noop}
                  onViewSegmentDetail={onViewSegmentDetail}
                  segmentNameDisplayMode={segmentNameDisplayMode}
                  segmentSpellingMode={segmentSpellingMode}
                  onSegmentSpellingPatch={onSegmentSpellingPatch}
                  customColumns={customColumns}
                  visibleCustomColumns={visibleCustomColumns}
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
