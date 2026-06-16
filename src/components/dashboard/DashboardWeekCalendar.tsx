import React, { useMemo } from 'react';
import type { CalendarLayoutBlock, DashboardEventSummary } from '../../types/dashboard';
import {
  DASHBOARD_CALENDAR_HOUR_END,
  DASHBOARD_CALENDAR_HOUR_START,
  DASHBOARD_CALENDAR_ROW_HEIGHT_PX,
  addDays,
  blockHeightPx,
  blockTopPx,
  calendarHourLabels,
  collectWeekDateOnlyBlocks,
  collectWeekBlocks,
  formatDateKey,
  formatMonthDay,
  formatWeekdayShort,
  getLocationColor,
  getRecordStreamingColor,
  minutesToLabel,
  startOfWeekSunday,
} from '../../lib/dashboardUtils';

type DashboardWeekCalendarProps = {
  events: DashboardEventSummary[];
  weekStart: Date;
  onWeekChange: (next: Date) => void;
  onSelectEvent?: (event: DashboardEventSummary) => void;
};

const DashboardWeekCalendar: React.FC<DashboardWeekCalendarProps> = ({
  events,
  weekStart,
  onWeekChange,
  onSelectEvent,
}) => {
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const layoutByDay = useMemo(() => collectWeekBlocks(events, weekStart), [events, weekStart]);
  const dateOnlyByDay = useMemo(() => collectWeekDateOnlyBlocks(events, weekStart), [events, weekStart]);
  const hourLabels = useMemo(() => calendarHourLabels(), []);
  const totalHours = DASHBOARD_CALENDAR_HOUR_END - DASHBOARD_CALENDAR_HOUR_START + 1;
  const gridHeight = totalHours * DASHBOARD_CALENDAR_ROW_HEIGHT_PX;
  const hasAnyDateOnly = useMemo(
    () => weekDates.some((date) => (dateOnlyByDay.get(formatDateKey(date)) || []).length > 0),
    [weekDates, dateOnlyByDay]
  );

  const weekLabel = `${formatMonthDay(weekDates[0])} – ${formatMonthDay(weekDates[6])}, ${weekDates[6].getFullYear()}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-white">Week view</h2>
          <p className="text-sm text-slate-400">{weekLabel} · timed events use Run of Show start + cue durations</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onWeekChange(addDays(weekStart, -7))}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
          >
            ← Prev
          </button>
          <button
            type="button"
            onClick={() => onWeekChange(startOfWeekSunday(new Date()))}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onWeekChange(addDays(weekStart, 7))}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
          >
            Next →
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-600 bg-slate-900/60">
        <div className="min-w-[920px]">
          <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-slate-700 bg-slate-800/90">
            <div className="p-2" />
            {weekDates.map((date) => {
              const isToday = formatDateKey(date) === formatDateKey(new Date());
              return (
                <div
                  key={formatDateKey(date)}
                  className={`border-l border-slate-700 px-2 py-2 text-center ${isToday ? 'bg-blue-950/40' : ''}`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {formatWeekdayShort(date)}
                  </div>
                  <div className={`text-sm font-bold ${isToday ? 'text-blue-300' : 'text-white'}`}>
                    {formatMonthDay(date)}
                  </div>
                </div>
              );
            })}
          </div>

          {hasAnyDateOnly ? (
            <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-slate-700 bg-slate-900/40">
              <div className="flex items-center justify-end border-r border-slate-700 px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                No times yet
              </div>
              {weekDates.map((date) => {
                const dateKey = formatDateKey(date);
                const dateOnlyBlocks = dateOnlyByDay.get(dateKey) || [];
                const isToday = dateKey === formatDateKey(new Date());

                return (
                  <div
                    key={`date-only-${dateKey}`}
                    className={`min-h-[36px] space-y-1 border-l border-slate-700 p-1 ${isToday ? 'bg-blue-950/20' : ''}`}
                  >
                    {dateOnlyBlocks.map(({ event, dayBlock }) => {
                      const locColor = getLocationColor(event.location);
                      return (
                        <button
                          key={`${event.id}-date-only-${dayBlock.dayNumber}`}
                          type="button"
                          onClick={() => onSelectEvent?.(event)}
                          className={`w-full rounded-md border border-dashed border-white/30 px-1.5 py-1 text-left shadow-sm transition hover:brightness-110 ${locColor}`}
                          title={`${event.name} · ${event.location} — no Run of Show data yet (event date only)`}
                        >
                          <div className="truncate text-[10px] font-bold leading-tight text-white">{event.name}</div>
                          <div className="truncate text-[9px] text-white/85">{event.location}</div>
                          <div className="mt-0.5 text-[9px] font-medium text-white/75">No ROS data yet</div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
            <div className="relative border-r border-slate-700" style={{ height: gridHeight }}>
              {hourLabels.map((label, index) => (
                <div
                  key={label}
                  className="absolute right-2 -translate-y-1/2 text-[10px] text-slate-500"
                  style={{ top: index * DASHBOARD_CALENDAR_ROW_HEIGHT_PX + DASHBOARD_CALENDAR_ROW_HEIGHT_PX / 2 }}
                >
                  {label}
                </div>
              ))}
            </div>

            {weekDates.map((date) => {
              const dateKey = formatDateKey(date);
              const blocks = layoutByDay.get(dateKey) || [];
              const isToday = dateKey === formatDateKey(new Date());

              return (
                <div
                  key={dateKey}
                  className={`relative border-l border-slate-700 ${isToday ? 'bg-blue-950/20' : ''}`}
                  style={{ height: gridHeight }}
                >
                  {hourLabels.map((_, index) => (
                    <div
                      key={index}
                      className="absolute left-0 right-0 border-t border-slate-800/80"
                      style={{ top: index * DASHBOARD_CALENDAR_ROW_HEIGHT_PX }}
                    />
                  ))}

                  {blocks.map((block: CalendarLayoutBlock) => {
                    const widthPct = 100 / block.columnCount;
                    const leftPct = block.column * widthPct;
                    const top = blockTopPx(block.dayBlock.startMinutes);
                    const height = blockHeightPx(block.dayBlock.startMinutes, block.dayBlock.endMinutes);
                    const rsColor = getRecordStreamingColor(block.event.recordStreaming);
                    const locColor = getLocationColor(block.event.location);

                    return (
                      <button
                        key={`${block.event.id}-${block.dayBlock.dayNumber}-${block.column}`}
                        type="button"
                        onClick={() => onSelectEvent?.(block.event)}
                        className={`absolute overflow-hidden rounded-md border border-white/10 px-1.5 py-1 text-left shadow-sm transition hover:brightness-110 ${locColor}`}
                        style={{
                          top,
                          height,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          minHeight: 18,
                        }}
                        title={`${block.event.name} · ${minutesToLabel(block.dayBlock.startMinutes)} – ${minutesToLabel(block.dayBlock.endMinutes)}`}
                      >
                        <div className="truncate text-[11px] font-bold leading-tight text-white">{block.event.name}</div>
                        <div className="truncate text-[10px] text-white/85">{block.event.location}</div>
                        <div className="truncate text-[10px] text-white/75">
                          {minutesToLabel(block.dayBlock.startMinutes)} – {minutesToLabel(block.dayBlock.endMinutes)}
                        </div>
                        {block.event.recordStreaming !== 'None' ? (
                          <span className={`mt-0.5 inline-block rounded px-1 text-[9px] font-semibold text-white ${rsColor}`}>
                            {block.event.recordStreaming}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Events with no Run of Show data appear under <span className="text-slate-400">No times yet</span> (event date
        only, not a timed block). Once cues exist, they move into the hour grid below.
      </p>
    </div>
  );
};

export default DashboardWeekCalendar;
