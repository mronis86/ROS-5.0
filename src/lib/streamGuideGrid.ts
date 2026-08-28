import type { DashboardDayBlock, DashboardEventSummary } from '../types/dashboard';
import { LOCATION_OPTIONS } from '../types/Event';
import { formatDateKey } from './dashboardUtils';
import { liveProgramKey } from './streamGuideLive';

export const TV_GUIDE_HOUR_START = 6;
export const TV_GUIDE_HOUR_END = 22;
export const TV_GUIDE_ROW_HEIGHT_PX = 52;
export const TV_GUIDE_HOUR_WIDTH_PX = 72;

export interface TvGuideProgram {
  event: DashboardEventSummary;
  dayBlock: DashboardDayBlock;
  isLive: boolean;
  blockKey: string;
}

export interface TvGuideChannel {
  channelNumber: number;
  location: string;
  programs: TvGuideProgram[];
}

export function programBlockKey(eventId: string, dayBlock: DashboardDayBlock): string {
  return `${eventId}:${dayBlock.dayNumber}:${dayBlock.calendarDate}`;
}

export function buildTvGuideChannels(
  events: DashboardEventSummary[],
  dateKey: string,
  liveProgramKeys: Set<string>
): TvGuideChannel[] {
  const byLocation = new Map<string, TvGuideProgram[]>();

  for (const event of events) {
    for (const dayBlock of event.dayBlocks) {
      if (dayBlock.calendarDate !== dateKey || dayBlock.dateOnly) continue;
      const key = programBlockKey(event.id, dayBlock);
      const list = byLocation.get(event.location) || [];
      list.push({
        event,
        dayBlock,
        isLive: liveProgramKeys.has(key),
        blockKey: key,
      });
      byLocation.set(event.location, list);
    }
  }

  const orderedLocations = LOCATION_OPTIONS.map((o) => o.value);
  const extraLocations = [...byLocation.keys()].filter((l) => !orderedLocations.includes(l));
  const allLocations = [...orderedLocations, ...extraLocations].filter((l) => byLocation.has(l));

  return allLocations.map((location, index) => ({
    channelNumber: index + 1,
    location,
    programs: (byLocation.get(location) || []).sort(
      (a, b) => a.dayBlock.startMinutes - b.dayBlock.startMinutes
    ),
  }));
}

export function tvGuideBlockLeftPx(startMinutes: number): number {
  return ((startMinutes - TV_GUIDE_HOUR_START * 60) / 60) * TV_GUIDE_HOUR_WIDTH_PX;
}

export function tvGuideBlockWidthPx(startMinutes: number, endMinutes: number): number {
  return Math.max(48, ((endMinutes - startMinutes) / 60) * TV_GUIDE_HOUR_WIDTH_PX);
}

export function tvGuideTotalWidthPx(): number {
  return (TV_GUIDE_HOUR_END - TV_GUIDE_HOUR_START + 1) * TV_GUIDE_HOUR_WIDTH_PX;
}

export function tvGuideHourLabels(): string[] {
  const labels: string[] = [];
  for (let h = TV_GUIDE_HOUR_START; h <= TV_GUIDE_HOUR_END; h++) {
    const period = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    labels.push(`${h12} ${period}`);
  }
  return labels;
}

export function tvGuideNowLinePx(nowMinutes: number): number | null {
  const start = TV_GUIDE_HOUR_START * 60;
  const end = TV_GUIDE_HOUR_END * 60 + 60;
  if (nowMinutes < start || nowMinutes > end) return null;
  return tvGuideBlockLeftPx(nowMinutes);
}

export function pickDefaultGuideDate(events: DashboardEventSummary[], today = new Date()): string {
  const todayKey = formatDateKey(today);
  const dated = new Set<string>();
  for (const event of events) {
    for (const block of event.dayBlocks) {
      if (!block.dateOnly) dated.add(block.calendarDate);
    }
  }
  if (dated.has(todayKey)) return todayKey;
  const sorted = [...dated].sort();
  const upcoming = sorted.find((d) => d >= todayKey);
  return upcoming || sorted[sorted.length - 1] || todayKey;
}
