import React from 'react';
import { Event } from '../../types/Event';
import { LOCATION_OPTIONS, DAYS_OPTIONS } from '../../types/Event';

type Tab = 'upcoming' | 'past';

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
  return (
    <div className="space-y-3 pb-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
        <div className="bg-slate-800 rounded-lg p-0.5 flex w-full sm:w-auto">
          <button
            type="button"
            onClick={() => onTabChange('upcoming')}
            className={`flex-1 sm:flex-none px-3 py-2.5 rounded-md text-sm font-semibold transition-colors ${
              activeTab === 'upcoming' ? 'bg-green-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Upcoming
          </button>
          <button
            type="button"
            onClick={() => onTabChange('past')}
            className={`flex-1 sm:flex-none px-3 py-2.5 rounded-md text-sm font-semibold transition-colors ${
              activeTab === 'past' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Past
          </button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
          <button
            type="button"
            onClick={onAddClick}
            className="w-full sm:w-auto px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            + Add New Event
          </button>
          <button
            type="button"
            onClick={onQuickMode}
            className="w-full sm:w-auto px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg transition-colors"
            title="Run quick ad-hoc timers without creating an event"
          >
            Quick Mode
          </button>
        </div>
      </div>

      <div className="bg-slate-800 rounded-lg p-3 space-y-3">
        <div>
          <label className="block text-white font-semibold text-xs mb-1">Search</label>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Name or location…"
            className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-blue-500 focus:outline-none text-sm min-h-[44px]"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-white font-semibold text-xs mb-1">Location</label>
            <select
              value={filterLocation}
              onChange={(e) => onFilterLocationChange(e.target.value)}
              className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-blue-500 focus:outline-none text-sm min-h-[44px]"
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
            <label className="block text-white font-semibold text-xs mb-1">Duration (days)</label>
            <select
              value={filterDays}
              onChange={(e) => onFilterDaysChange(e.target.value)}
              className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white focus:border-blue-500 focus:outline-none text-sm min-h-[44px]"
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
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="w-full py-2.5 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg font-medium text-sm text-white min-h-[44px]"
        >
          {isLoading ? 'Refreshing…' : 'Refresh list'}
        </button>
        <p className="text-center text-[11px] text-slate-400">Events do not auto-refresh.</p>
      </div>

      {isLoading && (
        <div className="text-center py-2 text-blue-400 text-sm">Loading events…</div>
      )}

      <div className="space-y-3">
        {filteredEvents.length === 0 ? (
          <div className="bg-slate-800 rounded-xl border border-slate-600 p-8 text-center">
            <div className="text-5xl mb-3">{activeTab === 'upcoming' ? '📅' : '📋'}</div>
            <h3 className="text-lg font-bold text-white mb-1">No {activeTab} events</h3>
            <p className="text-slate-400 text-sm">
              {activeTab === 'upcoming'
                ? 'Add an event to get started.'
                : 'Past events will appear here.'}
            </p>
          </div>
        ) : (
          filteredEvents.map((event) => {
            const rec = getRecordStreamingShort(event.recordStreaming || 'None');
            return (
              <article
                key={event.id}
                className="bg-slate-800 rounded-xl border border-slate-600 p-4 shadow-lg"
              >
                <h2 className="text-base font-bold text-white leading-snug mb-2">{event.name}</h2>
                <p className="text-sm text-slate-300 mb-3">{formatDate(event.date)}</p>
                <div className="flex flex-wrap gap-2 mb-4">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-700/80 px-2 py-1 text-xs text-slate-200">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${getLocationColor(event.location)}`} />
                    {event.location}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium text-white ${getEventTypeColor(event.eventType || 'Staged Production')}`}
                  >
                    {getEventTypeShortLabel(event.eventType || 'Staged Production')}
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium text-white ${getRecordStreamingColor(event.recordStreaming || 'None')}`}
                    title={rec.title}
                  >
                    {rec.label}
                  </span>
                  <span className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-slate-700 text-slate-200">
                    {event.numberOfDays}d · {event.timezone || 'America/New_York'}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => onLaunch(event)}
                    className="py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold min-h-[44px]"
                  >
                    Launch
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(event)}
                    className="py-3 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-semibold min-h-[44px]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(event)}
                    className="py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold min-h-[44px]"
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
