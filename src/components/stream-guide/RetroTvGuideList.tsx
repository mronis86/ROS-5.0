import React, { useMemo } from 'react';
import { buildUpcomingGuideList, type GuideListEntry } from '../../lib/streamGuideList';
import { downloadStreamGuideIcs } from '../../lib/streamGuideCalendar';
import { formatLongDate, getLocationColor, minutesToLabel } from '../../lib/dashboardUtils';
import type { DashboardEventSummary } from '../../types/dashboard';

type RetroTvGuideListProps = {
  events: DashboardEventSummary[];
  liveProgramKeys: Set<string>;
  totalCount: number;
};

const LOCATION_BADGE_CLASS =
  'inline-flex h-7 w-[7.25rem] shrink-0 items-center justify-center truncate rounded px-1.5 text-[10px] font-bold leading-none text-white';

const CALENDAR_BTN_CLASS =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#ffd700]/70 bg-[#2a4a1a] text-sm text-[#ffd700] transition-colors hover:bg-[#3d6a24] hover:text-white';

const ROW_CLASS = 'flex items-center gap-4 px-4 py-2.5 sm:gap-6 sm:px-5';

function formatTimeRange(entry: GuideListEntry): string {
  if (entry.dayBlock.dateOnly) return 'Times pending';
  const start = minutesToLabel(entry.dayBlock.startMinutes);
  const end = minutesToLabel(entry.dayBlock.endMinutes);
  return `${start} – ${end}`;
}

function CalendarSaveButton({ entry }: { entry: GuideListEntry }) {
  return (
    <button
      type="button"
      onClick={() => downloadStreamGuideIcs(entry)}
      className={CALENDAR_BTN_CLASS}
      title="Save to your calendar"
      aria-label="Save to your calendar"
    >
      📅
    </button>
  );
}

const RetroTvGuideList: React.FC<RetroTvGuideListProps> = ({ events, liveProgramKeys, totalCount }) => {
  const groups = useMemo(
    () => buildUpcomingGuideList(events, liveProgramKeys),
    [events, liveProgramKeys]
  );

  const rowCount = groups.reduce((n, g) => n + g.entries.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col retro-tv-guide-list">
      <div className="shrink-0 border-b border-[#4a6fa5] bg-[#121a5c] px-4 py-2 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#ffd700]">
            Upcoming streams
          </span>
          <span className="text-[10px] text-[#8aa8cc]">
            {rowCount} airing{rowCount === 1 ? '' : 's'} · {totalCount} event{totalCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-[#8aa8cc]">
          No upcoming record / streaming events scheduled.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto retro-tv-scanlines">
          <div
            className={`${ROW_CLASS} sticky top-0 z-10 border-b border-[#4a6fa5] bg-[#1a2568] text-[9px] font-bold uppercase tracking-wider text-[#a8c4e8]`}
          >
            <span className="w-[5.5rem] shrink-0 sm:w-[6rem]">Time</span>
            <span className="min-w-0 max-w-md shrink">Program</span>
            <div className="ml-auto flex shrink-0 items-center gap-3 sm:gap-4">
              <span className="w-[7.25rem] text-center">Location</span>
              <span className="w-[7rem] text-center leading-tight text-[#ffd700]">Add to calendar</span>
            </div>
          </div>

          {groups.map((group) => (
            <section key={group.dateKey}>
              <div
                className="border-y border-[#ffd700]/40 bg-[#0d1440] px-4 py-2 text-xs font-bold uppercase tracking-wide text-[#ffd700] sm:px-5"
              >
                {formatLongDate(group.dateKey)}
              </div>

              {group.entries.map((entry) => (
                <div
                  key={entry.blockKey}
                  className={`${ROW_CLASS} border-b border-[#1e3058] ${
                    entry.isLive ? 'bg-[#3d0a14]/80' : 'bg-[#081228]/60 hover:bg-[#0d1838]'
                  }`}
                >
                  <div className="w-[5.5rem] shrink-0 text-[11px] font-semibold leading-snug text-[#b8d4f0] sm:w-[6rem] sm:text-xs">
                    {formatTimeRange(entry)}
                    {entry.event.numberOfDays > 1 && !entry.dayBlock.dateOnly ? (
                      <span className="mt-0.5 block text-[9px] text-[#6a8fc4]">
                        Day {entry.dayBlock.dayNumber}
                      </span>
                    ) : null}
                  </div>

                  <div className="min-w-0 max-w-md shrink">
                    <div className="truncate font-bold text-white">{entry.event.name}</div>
                    {entry.isLive ? (
                      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-[#ff8888]">
                        ● On air now
                      </div>
                    ) : null}
                  </div>

                  <div className="ml-auto flex shrink-0 items-center gap-3 sm:gap-4">
                    <span
                      className={`${LOCATION_BADGE_CLASS} ${getLocationColor(entry.event.location)}`}
                    >
                      {entry.event.location}
                    </span>
                    <div className="flex w-[7rem] shrink-0 justify-center">
                      <CalendarSaveButton entry={entry} />
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default RetroTvGuideList;
