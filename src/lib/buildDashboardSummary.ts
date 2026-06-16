import type {
  DashboardContentReviewSummary,
  DashboardDayBlock,
  DashboardEventSummary,
  DashboardSummaryResponse,
} from '../types/dashboard';
import type { CalendarEvent } from '../services/database';
import { isQuickModeCalendarEvent } from './quickModeEvent';

function parseHHMMToMinutes(hhmm: string | null | undefined): number {
  if (!hhmm || typeof hhmm !== 'string') return 9 * 60;
  const parts = hhmm.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 9 * 60;
  return h * 60 + m;
}

function addDaysToDateString(dateStr: string, daysToAdd: number): string {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + daysToAdd);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function computeDayDurationMinutes(scheduleItems: any[], day: number): number {
  let minutes = 0;
  for (const item of scheduleItems || []) {
    if ((item.day || 1) !== day) continue;
    minutes += (item.durationHours || 0) * 60 + (item.durationMinutes || 0);
    minutes += Math.floor((item.durationSeconds || 0) / 60);
  }
  return minutes;
}

export function summarizeContentReviews(
  reviews: Record<string, any> | null | undefined,
  scheduleItems: any[]
): DashboardContentReviewSummary {
  const items = scheduleItems || [];
  const reviewMap = reviews && typeof reviews === 'object' ? reviews : {};
  let approvedCues = 0;
  let pendingCues = 0;
  let needsUpdateCues = 0;

  for (const item of items) {
    const key = String(item.id);
    const entry = reviewMap[key] || reviewMap[item.id] || null;
    const creative = entry?.creative?.status || 'pending';
    const ros = entry?.ros?.status || 'pending';
    if (creative === 'approved' && ros === 'approved') approvedCues += 1;
    else if (creative === 'needs_update' || ros === 'needs_update') needsUpdateCues += 1;
    else pendingCues += 1;
  }

  const totalCues = items.length;
  return {
    totalCues,
    approvedCues,
    pendingCues,
    needsUpdateCues,
    openCues: totalCues - approvedCues,
    hasReviewData: Object.keys(reviewMap).length > 0,
  };
}

export function buildDashboardDayBlocks(
  eventDate: string,
  numberOfDays: number,
  settings: any,
  scheduleItems: any[]
): {
  blocks: DashboardDayBlock[];
  masterStartTime: string;
  dayStartTimes: Record<number, string>;
  hasScheduleTimes: boolean;
} {
  const sd = settings && typeof settings === 'object' ? settings : {};
  const masterStartTime = sd.masterStartTime || sd.dayStartTimes?.['1'] || '09:00';
  const dayStartTimes =
    sd.dayStartTimes && typeof sd.dayStartTimes === 'object' ? sd.dayStartTimes : {};
  const days = Math.max(1, numberOfDays || 1);
  const blocks: DashboardDayBlock[] = [];

  for (let day = 1; day <= days; day++) {
    const durationMinutes = computeDayDurationMinutes(scheduleItems, day);
    const hasTimes = (scheduleItems || []).length > 0 && durationMinutes > 0;

    if (!hasTimes) {
      blocks.push({
        dayNumber: day,
        calendarDate: addDaysToDateString(eventDate, day - 1),
        dateOnly: true,
        startMinutes: 0,
        endMinutes: 0,
      });
      continue;
    }

    const startMinutes = parseHHMMToMinutes(dayStartTimes[day] || dayStartTimes[String(day)] || masterStartTime);
    blocks.push({
      dayNumber: day,
      calendarDate: addDaysToDateString(eventDate, day - 1),
      dateOnly: false,
      startMinutes,
      endMinutes: startMinutes + durationMinutes,
    });
  }

  return {
    blocks,
    masterStartTime,
    dayStartTimes,
    hasScheduleTimes: (scheduleItems || []).length > 0,
  };
}

export function calendarEventToDashboardSummary(
  calEvent: CalendarEvent,
  rosRow: { settings?: any; schedule_items?: any[]; updated_at?: string } | null,
  reviews: Record<string, any> | null | undefined
): DashboardEventSummary {
  const sd = calEvent.schedule_data || {};
  const eventDate =
    typeof calEvent.date === 'string'
      ? calEvent.date.slice(0, 10)
      : new Date(calEvent.date).toISOString().slice(0, 10);
  const scheduleItems = rosRow?.schedule_items || [];
  const numberOfDays = sd.numberOfDays || 1;
  const dayInfo = buildDashboardDayBlocks(eventDate, numberOfDays, rosRow?.settings || {}, scheduleItems);

  return {
    id: String(calEvent.id || ''),
    name: calEvent.name || 'Untitled event',
    date: eventDate,
    location: sd.location || 'Great Hall',
    numberOfDays,
    timezone: sd.timezone || 'America/New_York',
    eventType: sd.eventType || 'Staged Production',
    recordStreaming: sd.recordStreaming || 'None',
    isQuickMode: isQuickModeCalendarEvent(calEvent),
    rosEventId: rosRow ? String(calEvent.id) : null,
    masterStartTime: dayInfo.masterStartTime,
    dayStartTimes: dayInfo.dayStartTimes,
    scheduleItemCount: scheduleItems.length,
    dayBlocks: dayInfo.blocks,
    hasScheduleTimes: dayInfo.hasScheduleTimes,
    contentReview: summarizeContentReviews(reviews, scheduleItems),
    rosUpdatedAt: rosRow?.updated_at || null,
  };
}

export type DashboardFetchDeps = {
  getCalendarEvents: () => Promise<CalendarEvent[]>;
  getRunOfShowData: (eventId: string) => Promise<{ settings?: any; schedule_items?: any[]; updated_at?: string } | null>;
  getContentReviewData: (eventId: string) => Promise<{ reviews?: Record<string, any> } | null>;
};

async function resolveRosForEvent(
  calEvent: CalendarEvent,
  getRunOfShowData: DashboardFetchDeps['getRunOfShowData']
) {
  const sd = calEvent.schedule_data || {};
  const ids = [String(calEvent.id || ''), sd.eventId].filter(Boolean);
  for (const id of ids) {
    try {
      const row = await getRunOfShowData(id);
      if (row?.schedule_items?.length || row?.settings) return row;
    } catch {
      /* try next id */
    }
  }
  return null;
}

async function resolveReviewsForEvent(
  calEvent: CalendarEvent,
  getContentReviewData: DashboardFetchDeps['getContentReviewData']
) {
  const sd = calEvent.schedule_data || {};
  const ids = [String(calEvent.id || ''), sd.eventId].filter(Boolean);
  for (const id of ids) {
    try {
      const row = await getContentReviewData(id);
      if (row?.reviews && Object.keys(row.reviews).length > 0) return row.reviews;
    } catch {
      /* try next id */
    }
  }
  try {
    const row = await getContentReviewData(String(calEvent.id || ''));
    return row?.reviews || {};
  } catch {
    return {};
  }
}

/** Used when /api/dashboard/summary is not deployed yet (404 on Railway). */
export async function buildDashboardSummaryFromExistingApis(
  deps: DashboardFetchDeps
): Promise<DashboardSummaryResponse> {
  const calendarEvents = await deps.getCalendarEvents();
  const events: DashboardEventSummary[] = [];

  await Promise.all(
    calendarEvents.map(async (calEvent) => {
      if (isQuickModeCalendarEvent(calEvent)) return;
      const [rosRow, reviews] = await Promise.all([
        resolveRosForEvent(calEvent, deps.getRunOfShowData),
        resolveReviewsForEvent(calEvent, deps.getContentReviewData),
      ]);
      events.push(calendarEventToDashboardSummary(calEvent, rosRow, reviews));
    })
  );

  events.sort((a, b) => a.date.localeCompare(b.date));

  return {
    events,
    generatedAt: new Date().toISOString(),
  };
}
