import React, { useEffect, useMemo, useState } from 'react';
import { Event, DAYS_OPTIONS, LOCATION_OPTIONS } from '../../types/Event';
import QuickModeBoltIcon from '../QuickModeBoltIcon';

type Tab = 'upcoming' | 'past' | 'quickMode';
type MobileSortKey = 'date_asc' | 'date_desc' | 'name_asc';

function parseEventDayTs(dateString: string): number {
  const parts = dateString.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
}

type EventListMobileViewProps = {
  filteredEvents: Event[];
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  filterLocation: string;
  onFilterLocationChange: (value: string) => void;
  filterDays: string;
  onFilterDaysChange: (value: string) => void;
  isLoading: boolean;
  onRefresh: () => void;
  onAddClick: () => void;
  onQuickMode: () => void;
  onOpenQuickModeSession?: (event: Event) => void;
  quickModeEventCount?: number;
  onBulkDeleteQuickMode?: () => void;
  onClearQuickModeSelection?: () => void;
  onLaunch: (event: Event) => void;
  onEdit: (event: Event) => void;
  onDelete: (event: Event) => void;
  formatDate: (dateString: string) => string;
  getLocationColor: (location: string) => string;
  getEventTypeColor: (eventType: string) => string;
  getEventTypeShortLabel: (eventType: string) => string;
  getRecordStreamingColor: (recordStreaming: string) => string;
  getRecordStreamingShort: (recordStreaming: string) => { label: string; title: string };
};

const EventListMobileView: React.FC<EventListMobileViewProps> = ({
  filteredEvents,
  activeTab,
  onTabChange,
  searchTerm,
  onSearchChange,
  filterLocation,
  onFilterLocationChange,
  filterDays,
  onFilterDaysChange,
  isLoading,
  onRefresh,
  onAddClick,
  onQuickMode,
  onOpenQuickModeSession,
  quickModeEventCount = 0,
  onBulkDeleteQuickMode,
  onLaunch,
  onEdit,
  onDelete,
  formatDate,
  getLocationColor,
  getEventTypeColor,
  getEventTypeShortLabel,
  getRecordStreamingColor,
  getRecordStreamingShort
}) => {
  const [sortKey, setSortKey] = useState<MobileSortKey>(() => (activeTab === 'past' ? 'date_desc' : 'date_asc'));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  useEffect(() => {
    setSortKey(activeTab === 'past' || activeTab === 'quickMode' ? 'date_desc' : 'date_asc');
  }, [activeTab]);

  const filtersActive = searchTerm.trim() !== '' || filterLocation !== 'all' || filterDays !== 'all';

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (searchTerm.trim()) parts.push(`"${searchTerm.trim()}"`);
    if (filterLocation !== 'all') {
      const label = LOCATION_OPTIONS.find((o) => o.value === filterLocation)?.label ?? filterLocation;
      parts.push(label);
    }
    if (filterDays !== 'all') parts.push(`${filterDays} day${filterDays === '1' ? '' : 's'}`);
    return parts.join(' • ');
  }, [searchTerm, filterLocation, filterDays]);

  const displayedEvents = useMemo(() => {
    const arr = [...filteredEvents];
    if (sortKey === 'name_asc') {
      arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    } else if (sortKey === 'date_desc') {
      arr.sort((a, b) => parseEventDayTs(b.date) - parseEventDayTs(a.date));
    } else {
      arr.sort((a, b) => parseEventDayTs(a.date) - parseEventDayTs(b.date));
    }
    return arr;
  }, [filteredEvents, sortKey]);

  useEffect(() => {
    if (!selectedEventId) return;
    if (!displayedEvents.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(null);
    }
  }, [displayedEvents, selectedEventId]);

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 pb-20">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-600 bg-slate-800 p-1">
          <button
            type="button"
            onClick={() => onTabChange('upcoming')}
            className={`min-h-[46px] rounded-lg px-2 text-xs font-bold transition-colors ${
              activeTab === 'upcoming' ? 'bg-green-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            Upcoming
          </button>
          <button
            type="button"
            onClick={() => onTabChange('past')}
            className={`min-h-[46px] rounded-lg px-2 text-xs font-bold transition-colors ${
              activeTab === 'past' ? 'bg-orange-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            Past
          </button>
          <button
            type="button"
            onClick={() => onTabChange('quickMode')}
            className={`inline-flex min-h-[46px] items-center justify-center gap-1 rounded-lg px-2 text-xs font-bold transition-colors ${
              activeTab === 'quickMode' ? 'bg-yellow-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            <QuickModeBoltIcon className="h-3.5 w-3.5" />
            Quick{quickModeEventCount > 0 ? ` (${quickModeEventCount})` : ''}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onAddClick}
            className="min-h-[44px] rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white shadow hover:bg-blue-500"
          >
            + Add Event
          </button>
          <button
            type="button"
            onClick={onQuickMode}
            className="min-h-[44px] rounded-lg bg-purple-600 px-3 py-2 text-sm font-bold text-white shadow hover:bg-purple-500"
            title="Open Quick Mode for ad-hoc timers"
          >
            Open Quick Mode
          </button>
        </div>
        {activeTab === 'quickMode' && onBulkDeleteQuickMode && displayedEvents.length > 0 ? (
          <button
            type="button"
            onClick={onBulkDeleteQuickMode}
            className="min-h-[44px] w-full rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white shadow hover:bg-red-600"
          >
            Delete all Quick Mode sessions ({displayedEvents.length})
          </button>
        ) : null}
      </div>

      <div className="space-y-2 rounded-xl border border-slate-600 bg-slate-900/80 p-3 shadow-md">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-slate-500">Sort</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as MobileSortKey)}
            className="min-h-[40px] flex-1 rounded-lg border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="date_asc">Date: oldest first</option>
            <option value="date_desc">Date: newest first</option>
            <option value="name_asc">Name: A to Z</option>
          </select>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold transition-colors ${
              filtersOpen ? 'border-blue-500 bg-blue-950/50 text-blue-100' : 'border-slate-600 bg-slate-800 text-white hover:bg-slate-700'
            }`}
            aria-expanded={filtersOpen}
          >
            <span aria-hidden>🔍</span>
            <span>{filtersOpen ? 'Hide filters' : 'Search and filters'}</span>
            {filtersActive && !filtersOpen ? (
              <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-slate-900">ON</span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-600 bg-slate-800 text-lg hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={isLoading ? 'Refreshing events' : 'Refresh event list'}
          >
            {isLoading ? '…' : '🔄'}
          </button>
        </div>

        {filtersActive && !filtersOpen && filterSummary ? (
          <p className="truncate text-center text-[11px] text-slate-500" title={filterSummary}>
            {filterSummary}
          </p>
        ) : null}

        {filtersOpen ? (
          <div className="space-y-3 border-t border-slate-700 pt-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Search</label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Name or location"
                className="min-h-[44px] w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Location</label>
                <select
                  value={filterLocation}
                  onChange={(e) => onFilterLocationChange(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="all">All locations</option>
                  {LOCATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Duration (days)</label>
                <select
                  value={filterDays}
                  onChange={(e) => onFilterDaysChange(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-base text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="all">Any length</option>
                  {DAYS_OPTIONS.map((days) => (
                    <option key={days} value={String(days)}>
                      {days} day{days > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-center text-[11px] text-slate-500">Events do not auto-refresh.</p>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between px-1">
        <p className="text-sm font-semibold text-slate-300">
          {displayedEvents.length} {displayedEvents.length === 1 ? 'event' : 'events'}
        </p>
        {isLoading ? <span className="text-xs text-blue-400">Loading…</span> : null}
      </div>

      <div className="space-y-2">
        {displayedEvents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-600 bg-slate-900/80 p-10 text-center">
            <div className="mb-3 flex justify-center">
              {activeTab === 'upcoming' ? (
                <span className="text-5xl">📅</span>
              ) : activeTab === 'quickMode' ? (
                <QuickModeBoltIcon className="h-12 w-12 text-yellow-500" />
              ) : (
                <span className="text-5xl">📋</span>
              )}
            </div>
            <h3 className="mb-1 text-lg font-bold text-white">
              {activeTab === 'quickMode' ? 'No Quick Mode sessions' : `No ${activeTab} events`}
            </h3>
            <p className="text-sm text-slate-400">
              {activeTab === 'upcoming'
                ? 'Add an event to get started.'
                : activeTab === 'quickMode'
                  ? 'Open Quick Mode to start timers.'
                  : 'Past events will appear here.'}
            </p>
          </div>
        ) : (
          displayedEvents.map((event) => {
            const rec = getRecordStreamingShort(event.recordStreaming || 'None');
            const selected = event.id === selectedEventId;
            const timezone = event.timezone || 'America/New_York';
            return (
              <article
                key={event.id}
                className={`overflow-hidden rounded-lg border bg-slate-950 shadow-sm ${
                  selected ? 'border-cyan-400' : 'border-slate-600'
                }`}
              >
                <div className="space-y-2 px-3 py-2.5">
                  <h2 className="min-w-0 truncate text-[15px] font-semibold leading-tight text-white">{event.name}</h2>
                  <p className="text-[11px] text-slate-400">{formatDate(event.date)}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200">
                      <span className={`h-2 w-2 rounded-full ${getLocationColor(event.location)}`} />
                      {event.location}
                    </span>
                    <span className={`inline-flex rounded px-2 py-0.5 text-[11px] text-white ${getEventTypeColor(event.eventType || 'Staged Production')}`}>
                      {getEventTypeShortLabel(event.eventType || 'Staged Production')}
                    </span>
                    <span className={`inline-flex rounded px-2 py-0.5 text-[11px] text-white ${getRecordStreamingColor(event.recordStreaming || 'None')}`}>
                      {rec.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>{event.numberOfDays} day{event.numberOfDays > 1 ? 's' : ''}</span>
                    <span className="truncate font-mono text-[10px] text-slate-300 max-w-[58%] text-right">{timezone}</span>
                  </div>
                </div>
                <div className="border-t border-slate-800 bg-slate-900/70 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setSelectedEventId((prev) => (prev === event.id ? null : event.id))}
                    className={`w-full rounded-md px-3 py-2 text-sm font-semibold ${
                      selected ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-100 hover:bg-slate-600'
                    }`}
                  >
                    {selected ? 'Hide actions' : 'Select'}
                  </button>
                  {selected ? (
                    <div className={`mt-2 grid gap-1.5 ${activeTab === 'quickMode' ? 'grid-cols-2' : 'grid-cols-3'}`}>
                      {activeTab === 'quickMode' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onOpenQuickModeSession?.(event)}
                            className="min-h-[36px] rounded-md bg-purple-600 px-2 py-1.5 text-xs font-bold text-white hover:bg-purple-500"
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(event)}
                            className="min-h-[36px] rounded-md bg-red-600 px-2 py-1.5 text-xs font-bold text-white hover:bg-red-500"
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <>
                      <button
                        type="button"
                        onClick={() => onLaunch(event)}
                        className="min-h-[36px] rounded-md bg-blue-600 px-2 py-1.5 text-xs font-bold text-white hover:bg-blue-500"
                      >
                        Launch
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(event)}
                        className="min-h-[36px] rounded-md bg-green-600 px-2 py-1.5 text-xs font-bold text-white hover:bg-green-500"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(event)}
                        className="min-h-[36px] rounded-md bg-red-600 px-2 py-1.5 text-xs font-bold text-white hover:bg-red-500"
                      >
                        Delete
                      </button>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
};

export default EventListMobileView;
