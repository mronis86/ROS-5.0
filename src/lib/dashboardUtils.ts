import type { CalendarLayoutBlock, DashboardDayBlock, DashboardEventSummary, DashboardTimeFilter } from '../types/dashboard';
import { LOCATION_OPTIONS, RECORD_STREAMING_OPTIONS } from '../types/Event';

export const DASHBOARD_CALENDAR_HOUR_START = 6;
export const DASHBOARD_CALENDAR_HOUR_END = 22;
export const DASHBOARD_CALENDAR_ROW_HEIGHT_PX = 44;

export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Sunday-start week (Outlook-style US default). */
export function startOfWeekSunday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function formatWeekdayShort(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

export function formatMonthDay(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatLongDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function minutesToLabel(totalMinutes: number): string {
  const hours24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  let hours12 = hours24 % 12;
  if (hours12 === 0) hours12 = 12;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`;
}

export function getRecordStreamingColor(value: string): string {
  return RECORD_STREAMING_OPTIONS.find((o) => o.value === value)?.color ?? 'bg-slate-500';
}

export function getLocationColor(location: string): string {
  return LOCATION_OPTIONS.find((o) => o.value === location)?.color ?? 'bg-gray-600';
}

export function isUpcomingEvent(event: DashboardEventSummary, today = new Date()): boolean {
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return parseLocalDate(event.date) >= todayStart;
}

export function isWithinDays(dateStr: string, days: number, from = new Date()): boolean {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = addDays(start, days);
  const d = parseLocalDate(dateStr);
  return d >= start && d <= end;
}

export function isPastEvent(event: DashboardEventSummary, today = new Date()): boolean {
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return parseLocalDate(event.date) < todayStart;
}

export function filterByTimeRange(
  events: DashboardEventSummary[],
  range: DashboardTimeFilter
): DashboardEventSummary[] {
  if (range === 'upcoming') return events.filter((e) => isUpcomingEvent(e));
  if (range === 'past') return events.filter((e) => isPastEvent(e));
  return events;
}

export function sortEventsByDate(
  events: DashboardEventSummary[],
  range: DashboardTimeFilter
): DashboardEventSummary[] {
  const arr = [...events];
  if (range === 'past') {
    arr.sort((a, b) => b.date.localeCompare(a.date));
  } else {
    arr.sort((a, b) => a.date.localeCompare(b.date));
  }
  return arr;
}

export function filterRecordStreamingEvents(events: DashboardEventSummary[]): DashboardEventSummary[] {
  return events.filter(
    (e) => !e.isQuickMode && (e.recordStreaming === 'Record' || e.recordStreaming === 'Streaming')
  );
}

/** Open content reviews — optional 30-day window when viewing upcoming only. */
export function filterOpenContentReviewEvents(
  events: DashboardEventSummary[],
  range: DashboardTimeFilter = 'upcoming'
): DashboardEventSummary[] {
  return events.filter((e) => {
    if (e.isQuickMode || e.contentReview.totalCues === 0 || e.contentReview.openCues === 0) return false;
    if (range === 'upcoming') return isUpcomingEvent(e) && isWithinDays(e.date, 30);
    if (range === 'past') return isPastEvent(e);
    return true;
  });
}

export function collectWeekBlocks(
  events: DashboardEventSummary[],
  weekStart: Date
): Map<string, CalendarLayoutBlock[]> {
  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    weekDates.push(formatDateKey(addDays(weekStart, i)));
  }

  const layout = new Map<string, CalendarLayoutBlock[]>();

  for (const dateKey of weekDates) {
    const blocksForDay = events.flatMap((event) => {
      if (event.isQuickMode) return [];
      return event.dayBlocks
        .filter((b) => b.calendarDate === dateKey && !b.dateOnly)
        .map((dayBlock) => ({ event, dayBlock }));
    });

    blocksForDay.sort((a, b) => a.dayBlock.startMinutes - b.dayBlock.startMinutes);

    const columns: { end: number }[] = [];
    const placed: CalendarLayoutBlock[] = [];

    for (const item of blocksForDay) {
      let columnIndex = columns.findIndex((col) => col.end <= item.dayBlock.startMinutes);
      if (columnIndex === -1) {
        columnIndex = columns.length;
        columns.push({ end: item.dayBlock.endMinutes });
      } else {
        columns[columnIndex].end = item.dayBlock.endMinutes;
      }
      placed.push({
        event: item.event,
        dayBlock: item.dayBlock,
        column: columnIndex,
        columnCount: 1,
      });
    }

    const columnCount = Math.max(1, columns.length);
    for (const p of placed) {
      p.columnCount = columnCount;
    }

    layout.set(dateKey, placed);
  }

  return layout;
}

export function collectWeekDateOnlyBlocks(
  events: DashboardEventSummary[],
  weekStart: Date
): Map<string, CalendarLayoutBlock[]> {
  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    weekDates.push(formatDateKey(addDays(weekStart, i)));
  }

  const layout = new Map<string, CalendarLayoutBlock[]>();

  for (const dateKey of weekDates) {
    const blocksForDay = events.flatMap((event) => {
      if (event.isQuickMode) return [];
      return event.dayBlocks
        .filter((b) => b.calendarDate === dateKey && b.dateOnly)
        .map((dayBlock) => ({ event, dayBlock }));
    });

    blocksForDay.sort((a, b) => a.event.name.localeCompare(b.event.name));

    layout.set(
      dateKey,
      blocksForDay.map((item, index) => ({
        event: item.event,
        dayBlock: item.dayBlock,
        column: index,
        columnCount: 1,
      }))
    );
  }

  return layout;
}

export function blockTopPx(startMinutes: number): number {
  return ((startMinutes - DASHBOARD_CALENDAR_HOUR_START * 60) / 60) * DASHBOARD_CALENDAR_ROW_HEIGHT_PX;
}

export function blockHeightPx(startMinutes: number, endMinutes: number): number {
  return Math.max(18, ((endMinutes - startMinutes) / 60) * DASHBOARD_CALENDAR_ROW_HEIGHT_PX);
}

export function calendarHourLabels(): string[] {
  const labels: string[] = [];
  for (let h = DASHBOARD_CALENDAR_HOUR_START; h <= DASHBOARD_CALENDAR_HOUR_END; h++) {
    const period = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    labels.push(`${h12} ${period}`);
  }
  return labels;
}

export function formatEventScheduleHint(event: DashboardEventSummary): string {
  if (!event.hasScheduleTimes || event.dayBlocks.every((b) => b.dateOnly)) {
    return 'No Run of Show data yet — only the event date is shown on the calendar';
  }
  const firstTimed = event.dayBlocks.find((b) => !b.dateOnly);
  if (!firstTimed) return 'Schedule times unavailable';
  const dayLabel = event.numberOfDays > 1 ? `Day ${firstTimed.dayNumber}: ` : '';
  return `${dayLabel}${minutesToLabel(firstTimed.startMinutes)} – ${minutesToLabel(firstTimed.endMinutes)} · ${event.scheduleItemCount} cues`;
}
