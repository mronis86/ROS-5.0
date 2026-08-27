import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessCreative, isCreativeOnlyUser } from '../services/auth-service';
import { DatabaseService } from '../services/database';
import { LOCATION_OPTIONS, normalizeDayLocations, parseDayLocations, type DayLocations } from '../types/Event';
import { isQuickModeCalendarEvent } from '../lib/quickModeEvent';
import { isEventPast, isEventUpcoming } from '../lib/eventActiveWindow';
import EventLocationCell from '../components/EventLocationCell';

type EventRow = {
  id: string;
  name: string;
  date: string;
  location: string;
  dayLocations?: DayLocations;
  numberOfDays: number;
  timezone: string;
  eventType: string;
  isQuickMode?: boolean;
};

function parseScheduleData(raw: unknown): Record<string, any> {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw as Record<string, any>;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }
  return {};
}

function locationDotClass(location: string): string {
  const opt = LOCATION_OPTIONS.find((o) => o.value === location);
  return opt?.color || 'bg-slate-500';
}

function eventTypeBadgeClass(eventType: string): string {
  switch (eventType) {
    case 'Staged Production':
      return 'bg-blue-600';
    case 'Corporate':
      return 'bg-indigo-600';
    case 'Broadcast':
      return 'bg-rose-600';
    default:
      return 'bg-slate-600';
  }
}

const CreativeEventListPage: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [searchTerm, setSearchTerm] = useState('');

  const allowed = canAccessCreative(user);

  const openEvent = (event: EventRow) => {
    navigate(
      `/creative/event?eventId=${encodeURIComponent(event.id)}&eventName=${encodeURIComponent(event.name)}&eventDate=${encodeURIComponent(event.date)}&eventLocation=${encodeURIComponent(event.location)}`
    );
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await DatabaseService.getCalendarEvents();
      const rows = (Array.isArray(list) ? list : [])
        .map((e: any) => {
          const sd = parseScheduleData(e.schedule_data);
          return {
            id: String(e.id),
            name: e.name || 'Untitled event',
            date:
              typeof e.date === 'string' && e.date.length >= 10
                ? e.date.slice(0, 10)
                : String(e.date || ''),
            location: String(sd.location || e.location || ''),
            dayLocations: normalizeDayLocations(
              String(sd.location || e.location || 'Great Hall'),
              Number(sd.numberOfDays) || 1,
              parseDayLocations(sd.dayLocations)
            ),
            numberOfDays: Number(sd.numberOfDays) || 1,
            timezone: String(sd.timezone || 'America/New_York'),
            eventType: String(sd.eventType || 'Staged Production'),
            isQuickMode: e.isQuickMode === true || isQuickModeCalendarEvent(e),
          } as EventRow;
        })
        .filter((e) => !e.isQuickMode);
      setEvents(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) {
      navigate('/', { replace: true });
      return;
    }
    void load();
  }, [allowed, authLoading, load, navigate]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return events
      .filter((e) => {
        const inTab =
          tab === 'upcoming'
            ? isEventUpcoming(e.date, e.numberOfDays)
            : isEventPast(e.date, e.numberOfDays);
        if (!inTab) return false;
        if (!q) return true;
        return (
          e.name.toLowerCase().includes(q) ||
          e.location.toLowerCase().includes(q) ||
          e.date.includes(q)
        );
      })
      .sort((a, b) =>
        tab === 'upcoming'
          ? String(a.date).localeCompare(String(b.date))
          : String(b.date).localeCompare(String(a.date))
      );
  }, [events, tab, searchTerm]);

  if (authLoading || !allowed) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-300 flex items-center justify-center">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white pt-[var(--app-header-height)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="text-center mb-4">
          <h1 className="text-xl sm:text-2xl font-bold text-white">Creative</h1>
          <p className="text-slate-400 text-sm mt-1 max-w-xl mx-auto">
            {isCreativeOnlyUser(user)
              ? 'Select an event to review content and follow the live run of show.'
              : 'Open an event for content review and read-only run of show.'}
          </p>
        </div>

        <div className="flex justify-center mb-3">
          <div className="bg-slate-800 rounded-lg p-0.5 flex">
            <button
              type="button"
              onClick={() => setTab('upcoming')}
              className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                tab === 'upcoming' ? 'bg-green-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              📅 Upcoming Events
            </button>
            <button
              type="button"
              onClick={() => setTab('past')}
              className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                tab === 'past' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              📋 Past Events
            </button>
          </div>
        </div>

        <div className="flex justify-center mb-4">
          <div className="bg-slate-800 rounded-lg p-3 w-full max-w-4xl">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-white font-semibold text-sm shrink-0">🔍 Search:</span>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by name, location, or date…"
                  className="w-full min-w-0 px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-white focus:border-violet-500 focus:outline-none text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="shrink-0 self-end sm:self-auto px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg font-medium transition-colors text-sm text-white"
                title="Refresh events list"
              >
                {loading ? '🔄 Refreshing...' : '🔄 Refresh'}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-red-200 text-sm mb-4">
            {error}
          </div>
        ) : null}

        <div className="bg-slate-800 rounded-xl p-3 sm:p-4 shadow-2xl">
          {loading && (
            <div className="text-center py-2 mb-2">
              <div className="text-violet-400 text-sm">🔄 Loading events...</div>
            </div>
          )}

          <div className="md:hidden space-y-3">
            {!loading && filtered.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="mb-3 text-5xl">{tab === 'upcoming' ? '📅' : '📋'}</div>
                <h3 className="text-xl font-bold text-white mb-1">No {tab} events</h3>
                <p className="text-slate-400 text-sm">
                  Ask an admin to assign event access if this list should not be empty.
                </p>
              </div>
            ) : (
              filtered.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => openEvent(event)}
                  className="w-full text-left rounded-lg border border-slate-600 bg-slate-900/60 p-4 hover:bg-slate-700/40 transition-colors"
                >
                  <div className="font-semibold text-white text-base leading-snug">{event.name}</div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-sm text-slate-300">
                    <span>{event.date}</span>
                    <span className="inline-flex items-center gap-1.5">
                      <EventLocationCell
                        location={event.location || 'Great Hall'}
                        numberOfDays={event.numberOfDays}
                        dayLocations={event.dayLocations}
                        getLocationColor={locationDotClass}
                        compact
                      />
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium text-white ${eventTypeBadgeClass(event.eventType)}`}
                    >
                      {event.eventType}
                    </span>
                    <span className="text-xs text-slate-400">
                      {event.numberOfDays} day{event.numberOfDays === 1 ? '' : 's'}
                    </span>
                    <span className="text-xs text-violet-300 ml-auto font-semibold">Open →</span>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="hidden md:block bg-slate-800 rounded-lg overflow-hidden border border-slate-600">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-700">
                  <tr>
                    <th className="px-3 py-2 text-left text-slate-300 font-semibold text-sm border-r border-slate-600 min-w-[220px]">
                      Event Name
                    </th>
                    <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600">
                      Date
                    </th>
                    <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600">
                      Location
                    </th>
                    <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600">
                      Type
                    </th>
                    <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600">
                      Duration
                    </th>
                    <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600">
                      Timezone
                    </th>
                    <th className="px-2 py-2 text-center text-slate-300 font-semibold text-sm min-w-[5.5rem]">
                      Open
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center">
                        <div className="mb-4 text-6xl">{tab === 'upcoming' ? '📅' : '📋'}</div>
                        <h3 className="text-2xl font-bold text-white mb-2">No {tab} events</h3>
                        <p className="text-slate-400 text-sm">
                          Ask an admin to assign event access if this list should not be empty.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((event) => (
                      <tr
                        key={event.id}
                        className="border-t border-slate-700 hover:bg-slate-700/50 transition-colors"
                      >
                        <td className="px-3 py-3 text-left border-r border-slate-700 font-medium text-white">
                          {event.name}
                        </td>
                        <td className="px-3 py-3 text-center border-r border-slate-700 text-slate-300 text-sm">
                          {event.date}
                        </td>
                        <td className="px-3 py-3 text-center border-r border-slate-700">
                          <div className="inline-flex justify-center text-sm text-slate-200">
                            <EventLocationCell
                              location={event.location || 'Great Hall'}
                              numberOfDays={event.numberOfDays}
                              dayLocations={event.dayLocations}
                              getLocationColor={locationDotClass}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center border-r border-slate-700">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium text-white ${eventTypeBadgeClass(event.eventType)}`}
                          >
                            {event.eventType}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center border-r border-slate-700 text-slate-300 text-sm">
                          {event.numberOfDays} day{event.numberOfDays === 1 ? '' : 's'}
                        </td>
                        <td className="px-3 py-3 text-center border-r border-slate-700 text-slate-400 text-xs">
                          {event.timezone}
                        </td>
                        <td className="px-2 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => openEvent(event)}
                            className="px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-white text-xs font-semibold rounded-lg"
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreativeEventListPage;
