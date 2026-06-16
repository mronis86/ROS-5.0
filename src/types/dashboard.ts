export type DashboardTab = 'calendar' | 'record-streaming' | 'content-review' | 'overview';

export type DashboardTimeFilter = 'upcoming' | 'past' | 'all';

export interface DashboardDayBlock {
  dayNumber: number;
  calendarDate: string;
  /** True when there is no Run of Show schedule to compute start/end times. */
  dateOnly: boolean;
  startMinutes: number;
  endMinutes: number;
}

export interface DashboardContentReviewSummary {
  totalCues: number;
  approvedCues: number;
  pendingCues: number;
  needsUpdateCues: number;
  openCues: number;
  hasReviewData: boolean;
}

export interface DashboardEventSummary {
  id: string;
  name: string;
  date: string;
  location: string;
  numberOfDays: number;
  timezone: string;
  eventType: string;
  recordStreaming: string;
  isQuickMode: boolean;
  rosEventId: string | null;
  masterStartTime: string | null;
  dayStartTimes: Record<number, string>;
  scheduleItemCount: number;
  dayBlocks: DashboardDayBlock[];
  contentReview: DashboardContentReviewSummary;
  rosUpdatedAt: string | null;
  hasScheduleTimes: boolean;
}

export interface DashboardSummaryResponse {
  events: DashboardEventSummary[];
  generatedAt: string;
}

export interface CalendarLayoutBlock {
  event: DashboardEventSummary;
  dayBlock: DashboardDayBlock;
  column: number;
  columnCount: number;
}
