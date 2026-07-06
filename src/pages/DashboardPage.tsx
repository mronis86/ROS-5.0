import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardWeekCalendar from '../components/dashboard/DashboardWeekCalendar';
import { DatabaseService } from '../services/database';
import { canAccessProductionDashboard } from '../services/auth-service';
import { useAuth } from '../contexts/AuthContext';
import type { DashboardEventSummary, DashboardTab, DashboardTimeFilter } from '../types/dashboard';
import {
  filterByTimeRange,
  filterOpenContentReviewEvents,
  filterRecordStreamingEvents,
  formatEventScheduleHint,
  formatLongDate,
  getLocationColor,
  getRecordStreamingColor,
  isUpcomingEvent,
  isWithinDays,
  sortEventsByDate,
  startOfWeekSunday,
} from '../lib/dashboardUtils';

const TIME_FILTERS: { id: DashboardTimeFilter; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'all', label: 'All' },
];

const TABS: { id: DashboardTab; label: string; description: string }[] = [
  { id: 'calendar', label: 'Week calendar', description: 'Outlook-style week grid with event hours and overlaps' },
  { id: 'record-streaming', label: 'Record / Stream', description: 'Events flagged for record or streaming' },
  { id: 'content-review', label: 'Open reviews', description: 'Events with unfinished content review cues' },
  { id: 'overview', label: 'Overview', description: 'Quick counts and upcoming highlights' },
];

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-600 bg-slate-800/80 p-4">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-sm font-semibold text-slate-200">{label}</div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<DashboardTab>('calendar');
  const [timeFilter, setTimeFilter] = useState<DashboardTimeFilter>('upcoming');
  const [events, setEvents] = useState<DashboardEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [weekStart, setWeekStart] = useState(() => startOfWeekSunday(new Date()));
  const [selectedEvent, setSelectedEvent] = useState<DashboardEventSummary | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!canAccessProductionDashboard(user)) {
      navigate('/', { replace: true });
    }
  }, [authLoading, user, navigate]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await DatabaseService.getDashboardSummary();
      if (!data?.events) {
        setError('Could not load dashboard data.');
        setEvents([]);
      } else {
        setEvents(data.events.filter((e) => !e.isQuickMode));
      }
    } catch (err) {
      console.error(err);
      setError('Failed to load dashboard.');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const recordStreamingEvents = useMemo(() => {
    const matched = filterRecordStreamingEvents(events);
    return sortEventsByDate(filterByTimeRange(matched, timeFilter), timeFilter);
  }, [events, timeFilter]);

  const openReviewEvents = useMemo(() => {
    const matched = filterOpenContentReviewEvents(events, timeFilter);
    return sortEventsByDate(matched, timeFilter);
  }, [events, timeFilter]);

  const overviewListEvents = useMemo(() => {
    const base =
      timeFilter === 'upcoming'
        ? events.filter((e) => isUpcomingEvent(e) && isWithinDays(e.date, 30))
        : filterByTimeRange(events, timeFilter);
    return sortEventsByDate(base, timeFilter).slice(0, 12);
  }, [events, timeFilter]);

  const showTimeFilter = activeTab !== 'calendar';

  const openRunOfShow = (event: DashboardEventSummary) => {
    navigate('/run-of-show', {
      state: {
        event: {
          id: event.id,
          name: event.name,
          date: event.date,
          location: event.location,
          numberOfDays: event.numberOfDays,
          timezone: event.timezone,
          eventType: event.eventType,
          recordStreaming: event.recordStreaming,
        },
      },
    });
  };

  const openContentReview = (event: DashboardEventSummary) => {
    navigate(`/content-review?eventId=${encodeURIComponent(event.id)}&eventName=${encodeURIComponent(event.name)}`);
  };

  const renderEventList = (
    list: DashboardEventSummary[],
    emptyMessage: string,
    options?: { showReview?: boolean; showRecord?: boolean }
  ) => {
    if (list.length === 0) {
      return <div className="rounded-xl border border-slate-600 bg-slate-900/50 p-6 text-sm text-slate-400">{emptyMessage}</div>;
    }

    return (
      <div className="space-y-2">
        {list.map((event) => (
          <div
            key={event.id}
            className="rounded-xl border border-slate-600 bg-slate-800/80 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-base font-bold text-white">{event.name}</h3>
                <span className={`rounded px-2 py-0.5 text-[10px] font-semibold text-white ${getLocationColor(event.location)}`}>
                  {event.location}
                </span>
                {options?.showRecord !== false && event.recordStreaming !== 'None' ? (
                  <span className={`rounded px-2 py-0.5 text-[10px] font-semibold text-white ${getRecordStreamingColor(event.recordStreaming)}`}>
                    {event.recordStreaming}
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-slate-300">{formatLongDate(event.date)}</p>
              <p className="text-xs text-slate-400">{formatEventScheduleHint(event)}</p>
              {options?.showReview ? (
                <p className="text-xs text-amber-300">
                  Content review: {event.contentReview.openCues} open
                  {event.contentReview.needsUpdateCues > 0 ? ` (${event.contentReview.needsUpdateCues} need updates)` : ''}
                  {' '}of {event.contentReview.totalCues} cues
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openRunOfShow(event)}
                className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500"
              >
                Run of Show
              </button>
              <button
                type="button"
                onClick={() => openContentReview(event)}
                className="rounded-lg border border-slate-500 bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-600"
              >
                Content Review
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-100 pt-[var(--app-header-height)]">
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Production Dashboard</h1>
            <p className="text-sm text-slate-400">Calendar overlaps, record/stream flags, and open content reviews</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700"
            >
              ← Event List
            </button>
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-600"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                activeTab === tab.id
                  ? 'bg-cyan-600 text-white shadow'
                  : 'border border-slate-600 bg-slate-800 text-slate-300 hover:text-white'
              }`}
              title={tab.description}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {showTimeFilter && !loading && !error ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Show</span>
            <div className="inline-flex rounded-lg border border-slate-600 bg-slate-800 p-0.5">
              {TIME_FILTERS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTimeFilter(opt.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    timeFilter === opt.id
                      ? opt.id === 'upcoming'
                        ? 'bg-green-600 text-white'
                        : opt.id === 'past'
                          ? 'bg-orange-600 text-white'
                          : 'bg-slate-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-500">
              {timeFilter === 'upcoming'
                ? 'Soonest first · open reviews limited to next 30 days'
                : timeFilter === 'past'
                  ? 'Most recent past first'
                  : 'Soonest first, includes past and future'}
            </span>
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-xl border border-slate-600 bg-slate-900/50 p-8 text-center text-slate-300">Loading dashboard…</div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/40 bg-red-950/30 p-6 text-red-200">{error}</div>
        ) : (
          <>
            {activeTab === 'calendar' ? (
              <DashboardWeekCalendar
                events={events}
                weekStart={weekStart}
                onWeekChange={setWeekStart}
                onSelectEvent={setSelectedEvent}
              />
            ) : null}

            {activeTab === 'record-streaming'
              ? renderEventList(
                  recordStreamingEvents,
                  timeFilter === 'past'
                    ? 'No past events are marked Record or Streaming.'
                    : timeFilter === 'all'
                      ? 'No events are marked Record or Streaming.'
                      : 'No upcoming events are marked Record or Streaming.',
                  { showReview: false }
                )
              : null}

            {activeTab === 'content-review'
              ? renderEventList(
                  openReviewEvents,
                  timeFilter === 'past'
                    ? 'No past events have open content review cues.'
                    : timeFilter === 'all'
                      ? 'No events have open content review cues.'
                      : 'No upcoming events in the next 30 days have open content review cues.',
                  { showReview: true, showRecord: true }
                )
              : null}

            {activeTab === 'overview' ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard
                    label={timeFilter === 'past' ? 'Past events' : timeFilter === 'all' ? 'All events' : 'Upcoming (30 days)'}
                    value={
                      timeFilter === 'upcoming'
                        ? events.filter((e) => isUpcomingEvent(e) && isWithinDays(e.date, 30)).length
                        : filterByTimeRange(events, timeFilter).length
                    }
                    hint="Excludes Quick Mode"
                  />
                  <StatCard label="Record / Stream" value={recordStreamingEvents.length} />
                  <StatCard
                    label="Open content reviews"
                    value={openReviewEvents.length}
                    hint={timeFilter === 'upcoming' ? 'Next 30 days' : undefined}
                  />
                  <StatCard label="With ROS schedule" value={overviewListEvents.filter((e) => e.hasScheduleTimes).length} />
                </div>
                <div>
                  <h2 className="mb-2 text-lg font-bold text-white">
                    {timeFilter === 'past' ? 'Past events' : timeFilter === 'all' ? 'All events' : 'Upcoming this month'}
                  </h2>
                  {renderEventList(
                    overviewListEvents,
                    timeFilter === 'past'
                      ? 'No past events found.'
                      : timeFilter === 'all'
                        ? 'No events found.'
                        : 'No events in the next 30 days.',
                    { showReview: true }
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}

        {selectedEvent ? (
          <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center">
            <div className="w-full max-w-lg rounded-2xl border border-slate-600 bg-slate-800 p-5 shadow-2xl">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-white">{selectedEvent.name}</h3>
                  <p className="text-sm text-slate-400">{formatLongDate(selectedEvent.date)} · {selectedEvent.location}</p>
                </div>
                <button type="button" onClick={() => setSelectedEvent(null)} className="text-slate-400 hover:text-white">
                  ✕
                </button>
              </div>
              <div className="space-y-2 text-sm text-slate-300">
                <p>{selectedEvent.eventType} · {selectedEvent.numberOfDays} day(s)</p>
                {selectedEvent.recordStreaming !== 'None' ? <p>Record/Stream: {selectedEvent.recordStreaming}</p> : null}
                <p>
                  Content review: {selectedEvent.contentReview.approvedCues}/{selectedEvent.contentReview.totalCues} cues approved
                  {selectedEvent.contentReview.openCues > 0 ? ` · ${selectedEvent.contentReview.openCues} open` : ''}
                </p>
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => openRunOfShow(selectedEvent)} className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-500">
                  Open Run of Show
                </button>
                <button type="button" onClick={() => openContentReview(selectedEvent)} className="flex-1 rounded-lg border border-slate-500 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                  Content Review
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default DashboardPage;
