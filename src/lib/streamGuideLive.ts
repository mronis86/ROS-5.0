import type { DashboardDayBlock, DashboardEventSummary } from '../types/dashboard';
import { minutesToLabel } from './dashboardUtils';

export interface LiveProgramInfo {
  event: DashboardEventSummary;
  dayBlock: DashboardDayBlock;
}

const DEFAULT_TZ = 'America/New_York';

function getTimeZoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  const hour = parseInt(pick('hour'), 10);
  const minute = parseInt(pick('minute'), 10);

  return {
    dateKey: `${year}-${month}-${day}`,
    minutes: Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0,
  };
}

/** Events whose scheduled window includes the current moment (timezone-aware per event). */
export function findLivePrograms(
  events: DashboardEventSummary[],
  now = new Date()
): LiveProgramInfo[] {
  const live: LiveProgramInfo[] = [];

  for (const event of events) {
    if (event.isQuickMode || !event.hasScheduleTimes) continue;
    const tz = event.timezone?.trim() || DEFAULT_TZ;
    const { dateKey, minutes: nowMinutes } = getTimeZoneParts(now, tz);

    for (const dayBlock of event.dayBlocks) {
      if (dayBlock.dateOnly) continue;
      if (dayBlock.calendarDate !== dateKey) continue;
      if (nowMinutes >= dayBlock.startMinutes && nowMinutes < dayBlock.endMinutes) {
        live.push({ event, dayBlock });
      }
    }
  }

  live.sort((a, b) => {
    const dateCmp = a.dayBlock.calendarDate.localeCompare(b.dayBlock.calendarDate);
    if (dateCmp !== 0) return dateCmp;
    return a.dayBlock.startMinutes - b.dayBlock.startMinutes;
  });

  return live;
}

export function formatLiveProgramWindow(info: LiveProgramInfo): string {
  const dayLabel =
    info.event.numberOfDays > 1 ? `Day ${info.dayBlock.dayNumber} · ` : '';
  return `${dayLabel}${minutesToLabel(info.dayBlock.startMinutes)} – ${minutesToLabel(info.dayBlock.endMinutes)}`;
}

export function liveProgramKey(info: LiveProgramInfo): string {
  return `${info.event.id}:${info.dayBlock.dayNumber}:${info.dayBlock.calendarDate}`;
}
