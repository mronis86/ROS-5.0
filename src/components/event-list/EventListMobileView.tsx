import React, { useEffect, useMemo, useState } from 'react';
import { Event } from '../../types/Event';
import { LOCATION_OPTIONS, DAYS_OPTIONS } from '../../types/Event';

type Tab = 'upcoming' | 'past';

export type MobileSortKey = 'date_asc' | 'date_desc' | 'name_asc';

function parseEventDayTs(dateString: string): number {
  const parts = dateString.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
}

export type EventListMobileViewProps = {
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

  useEffect(() => {
    setSortKey(activeTab === 'past' ? 'date_desc' : 'date_asc');
  }, [activeTab]);

  const filtersActive =
    searchTerm.trim() !== '' || filterLocation !== 'all' || filterDays !== 'all';

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (searchTerm.trim()) parts.push(`“${searchTerm.trim()}”`);
    if (filterLocation !== 'all') {
      const label = LOCATION_OPTIONS.find((o) => o.value === filterLocation)?.label ?? filterLocation;
      parts.push(label);
    }
    if (filterDays !== 'all') parts.push(`${filterDays} day${filterDays === '1' ? '' : 's'}`);
    return parts.join(' · ');
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

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-10 w-full">
      <div className="flex flex-col gap-3">
        <div className="bg-slate-800 rounded-xl p-1 flex w-full border border-slate-600">
          <button
            type="button"
            onClick={() => onTabChange('upcoming')}
            className={`flex-1 rounded-lg px-3 py-3 text-sm font-bold transition-colors min-h-[48px] ${
              activeTab === 'upcoming' ? 'bg-green-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            Upcoming
          </button>
          <button
            type="button"
            onClick={() => onTabChange('past')}
            className={`flex-1 rounded-lg px-3 py-3 text-sm font-bold transition-colors min-h-[48px] ${
              activeTab === 'past' ? 'bg-orange-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            Past
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onAddClick}
            className="w-full rounded-xl bg-blue-600 px-4 py-3.5 text-base font-bold text-white shadow hover:bg-blue-500 min-h-[48px]"
          >
            + Add New Event
          </button>
          <button
            type="button"
            onClick={onQuickMode}
            className="w-full rounded-xl bg-purple-600 px-4 py-3.5 text-base font-bold text-white shadow hover:bg-purple-500 min-h-[48px]"
            title="Run quick ad-hoc timers without creating an event"
          >
            Quick Mode
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-600 bg-slate-900/80 p-3 shadow-md space-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor="mobile-event-sort" className="sr-only">
            Sort list
          </label>
          <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-slate-500">Sort</span>
          <select
            id="mobile-event-sort"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as MobileSortKey)}
            className="min-h-[40px] flex-1 rounded-lg border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="date_asc">Date · oldest first</option>
            <option value="date_desc">Date · newest first</option>
            <option value="name_asc">Name · A to Z</option>
          </select>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border-2 px-3 text-sm font-bold transition-colors ${
              filtersOpen
                ? 'border-blue-500 bg-blue-950/50 text-blue-100'
                : 'border-slate-600 bg-slate-800 text-white hover:bg-slate-700'
            }`}
            aria-expanded={filtersOpen}
          >
            <span aria-hidden>🔍</span>
            <span className="truncate">{filtersOpen ? 'Hide search & filters' : 'Search & filters'}</span>
            {filtersActive && !filtersOpen ? (
              <span className="shrink-0 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-slate-900">ON</span>
            ) : null}
            <span className="shrink-0 text-slate-400" aria-hidden>
              {filtersOpen ? '▲' : '▼'}
            </span>
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            title="Refresh list"
            aria-label={isLoading ? 'Refreshing' : 'Refresh event list'}
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg border-2 border-slate-600 bg-slate-800 text-lg hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? <span className="text-sm">…</span> : <span aria-hidden>🔄</span>}
          </button>
        </div>

        {filtersActive && !filtersOpen && filterSummary ? (
          <p className="truncate px-0.5 text-center text-[11px] text-slate-500" title={filterSummary}>
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
                placeholder="Name or location…"
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-base text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none min-h-[44px]"
              />
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-400">Location</label>
                <select
                  value={filterLocation}
                  onChange={(e) => onFilterLocationChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-base text-white focus:border-blue-500 focus:outline-none min-h-[44px]"
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
                  className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-base text-white focus:border-blue-500 focus:outline-none min-h-[44px]"
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

      <div className="space-y-4">
        {displayedEvents.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-600 bg-slate-900/80 p-10 text-center">
            <div className="mb-4 text-6xl">{activeTab === 'upcoming' ? '📅' : '📋'}</div>
            <h3 className="mb-2 text-xl font-bold text-white">No {activeTab} events</h3>
            <p className="text-base text-slate-400 leading-relaxed">
              {activeTab === 'upcoming' ? 'Add an event to get started.' : 'Past events will appear here.'}
            </p>
          </div>
        ) : (
          displayedEvents.map((event) => {
            const rec = getRecordStreamingShort(event.recordStreaming || 'None');
            return (
              <article
                key={event.id}
                className="overflow-hidden rounded-2xl border-2 border-slate-500 bg-slate-950 shadow-lg ring-1 ring-white/10"
              >
                <div className="border-b border-slate-700 bg-slate-900 px-4 py-4">
                  <p className="font-mono text-sm font-semibold text-blue-300">{event.date}</p>
                  <h2 className="mt-2 text-xl font-bold leading-snug text-white">{event.name}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{formatDate(event.date)}</p>
                </div>
                <div className="flex flex-wrap gap-2 px-4 py-3">
                  <span className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${getLocationColor(event.location)}`} />
                    {event.location}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold text-white ${getEventTypeColor(event.eventType || 'Staged Production')}`}
                  >
                    {getEventTypeShortLabel(event.eventType || 'Staged Production')}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold text-white ${getRecordStreamingColor(event.recordStreaming || 'None')}`}
                    title={rec.title}
                  >
                    {rec.label}
                  </span>
                  <span className="inline-flex items-center rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200">
                    {event.numberOfDays}d · <span className="ml-1 font-mono text-xs">{event.timezone || 'America/New_York'}</span>
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 border-t border-slate-800 bg-slate-900/80 p-4 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => onLaunch(event)}
                    className="rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white shadow hover:bg-blue-500 min-h-[48px]"
                  >
                    Launch
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(event)}
                    className="rounded-xl bg-green-600 py-3.5 text-base font-bold text-white shadow hover:bg-green-500 min-h-[48px]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(event)}
                    className="rounded-xl bg-red-600 py-3.5 text-base font-bold text-white shadow hover:bg-red-500 min-h-[48px]"
                  >
                    Delete
                  </button>
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
