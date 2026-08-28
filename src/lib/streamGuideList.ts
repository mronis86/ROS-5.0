import type { DashboardDayBlock, DashboardEventSummary } from '../types/dashboard';
import { programBlockKey } from './streamGuideGrid';

export interface GuideListEntry {
  event: DashboardEventSummary;
  dayBlock: DashboardDayBlock;
  isLive: boolean;
  blockKey: string;
}

export interface GuideListDateGroup {
  dateKey: string;
  entries: GuideListEntry[];
}

/** All upcoming timed (and date-only) stream blocks, grouped by calendar date for scroll list. */
export function buildUpcomingGuideList(
  events: DashboardEventSummary[],
  liveProgramKeys: Set<string>
): GuideListDateGroup[] {
  const entries: GuideListEntry[] = [];

  for (const event of events) {
    for (const dayBlock of event.dayBlocks) {
      const blockKey = programBlockKey(event.id, dayBlock);
      entries.push({
        event,
        dayBlock,
        isLive: liveProgramKeys.has(blockKey),
        blockKey,
      });
    }
  }

  entries.sort((a, b) => {
    const dateCmp = a.dayBlock.calendarDate.localeCompare(b.dayBlock.calendarDate);
    if (dateCmp !== 0) return dateCmp;
    if (a.dayBlock.dateOnly && !b.dayBlock.dateOnly) return 1;
    if (!a.dayBlock.dateOnly && b.dayBlock.dateOnly) return -1;
    return a.dayBlock.startMinutes - b.dayBlock.startMinutes;
  });

  const groups: GuideListDateGroup[] = [];
  for (const entry of entries) {
    const dateKey = entry.dayBlock.calendarDate;
    const last = groups[groups.length - 1];
    if (!last || last.dateKey !== dateKey) {
      groups.push({ dateKey, entries: [entry] });
    } else {
      last.entries.push(entry);
    }
  }

  return groups;
}
