import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_EVENTS_LIST, formatEventDate } from './demoData';
import { LOCATION_DOT } from './showcaseConstants';
import { ShowcaseFakeCursor, showcaseTargetPoint, waitForElement, waitMs } from './ShowcaseFakeCursor';
import type { Event, EventFormData } from '../types/Event';
import {
  DAYS_OPTIONS,
  EVENT_TYPE_OPTIONS,
  LOCATION_OPTIONS,
  RECORD_STREAMING_OPTIONS,
  TIMEZONE_OPTIONS,
} from '../types/Event';

const AUTO_EVENT_ID = 'showcase-auto-investor-day';
const DEMO_EVENT_NAME = 'Investor Day 2026';
const DEMO_FORM_FINAL: EventFormData = {
  name: DEMO_EVENT_NAME,
  date: '2026-09-18',
  location: 'Briefing Center',
  numberOfDays: 1,
  timezone: 'America/New_York',
  eventType: 'Staged Production',
  recordStreaming: 'Streaming',
};

const EMPTY_FORM: EventFormData = {
  name: '',
  date: '',
  location: 'Great Hall',
  numberOfDays: 1,
  timezone: 'America/New_York',
  eventType: 'Staged Production',
  recordStreaming: 'None',
};

const TYPING_MS = 72;
const FIELD_PAUSE_MS = 450;
const MOVE_MS = 480;
const LOOP_HOLD_MS = 4800;
const LOOP_GAP_MS = 900;
const START_DELAY_MS = 1800;

const EVENT_TYPE_COLOR: Record<string, string> = {
  'Staged Production': 'bg-violet-600',
  'Studio Hit': 'bg-cyan-600',
  'General Meeting': 'bg-slate-500',
  'Hollow Square': 'bg-violet-500',
};

const BROADCAST_COLOR: Record<string, string> = {
  Record: 'bg-red-600',
  Streaming: 'bg-blue-600',
  None: 'bg-slate-600',
};

type ActiveField = 'name' | 'date' | 'location' | 'broadcast' | 'submit' | null;

function locationDot(location: string): string {
  const fromOptions = LOCATION_OPTIONS.find((o) => o.value === location)?.color;
  return LOCATION_DOT[location] || fromOptions || 'bg-gray-600';
}

function fieldRing(active: boolean) {
  return active ? 'ring-2 ring-blue-400 border-blue-400' : 'border-slate-600';
}

function EventTableRow({ event, isNew }: { event: Event; isNew?: boolean }) {
  return (
    <tr
      className={`border-b border-slate-600 transition-colors duration-500 ${
        isNew ? 'bg-blue-950/60 ring-2 ring-inset ring-blue-400' : ''
      }`}
    >
      <td className="px-3 py-2 text-white font-medium text-sm border-r border-slate-600">
        {event.name}
        {isNew && (
          <span className="ml-2 inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white align-middle">
            NEW
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-slate-300 text-sm border-r border-slate-600 text-center">
        {formatEventDate(event.date)}
      </td>
      <td className="px-3 py-2 border-r border-slate-600">
        <div className="flex items-center justify-center gap-1.5">
          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${locationDot(event.location)}`} />
          <span className="text-slate-300 text-sm">{event.location}</span>
        </div>
      </td>
      <td className="px-3 py-2 border-r border-slate-600 text-center">
        <span
          className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium text-white ${
            EVENT_TYPE_COLOR[event.eventType || ''] || 'bg-slate-500'
          }`}
        >
          {event.eventType === 'Staged Production'
            ? 'Staged'
            : event.eventType === 'General Meeting'
              ? 'Meeting'
              : event.eventType === 'Studio Hit'
                ? 'Studio'
                : event.eventType?.slice(0, 8) || '—'}
        </span>
      </td>
      <td className="px-3 py-2 border-r border-slate-600 text-center">
        <span
          className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium text-white ${
            BROADCAST_COLOR[event.recordStreaming || 'None']
          }`}
        >
          {event.recordStreaming === 'None'
            ? 'None'
            : event.recordStreaming === 'Record'
              ? 'Rec'
              : 'Stream'}
        </span>
      </td>
      <td className="px-3 py-2 text-slate-300 text-sm border-r border-slate-600 text-center">
        {event.numberOfDays} day{event.numberOfDays !== 1 ? 's' : ''}
      </td>
      <td className="px-3 py-2 text-slate-300 border-r border-slate-600 text-center">
        <span className="text-xs font-mono">{event.timezone}</span>
      </td>
      <td className="px-2 py-2 text-center">
        <span className="px-2 py-1 bg-blue-600 text-white text-xs rounded">Open ROS</span>
      </td>
    </tr>
  );
}

export const EventListShowcaseContent: React.FC = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const locationSelectRef = useRef<HTMLSelectElement>(null);
  const broadcastSelectRef = useRef<HTMLSelectElement>(null);
  const submitBtnRef = useRef<HTMLButtonElement>(null);
  const refreshBtnRef = useRef<HTMLButtonElement>(null);

  const [events, setEvents] = useState<Event[]>(() => [...DEMO_EVENTS_LIST]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState<EventFormData>(EMPTY_FORM);
  const [newEventId, setNewEventId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cursor, setCursor] = useState({ x: 680, y: 130, visible: false, clicking: false });
  const [activeField, setActiveField] = useState<ActiveField>(null);
  const demoRunningRef = useRef(false);
  const userPausedRef = useRef(false);

  const moveTo = useCallback(
    async (el: HTMLElement | null, click = false, anchor: 'tap' | 'center' = 'tap') => {
      if (!el) return;
      const pt = showcaseTargetPoint(el, rootRef.current, { anchor });
      setCursor((c) => ({ ...c, x: pt.x, y: pt.y, visible: true, clicking: false }));
      await waitMs(MOVE_MS);
      if (click) {
        setCursor((c) => ({ ...c, clicking: true }));
        await waitMs(280);
        setCursor((c) => ({ ...c, clicking: false }));
      }
    },
    []
  );

  const refreshAndReset = useCallback(async () => {
    setShowAddModal(false);
    setFormData(EMPTY_FORM);
    setActiveField(null);
    setNewEventId(null);
    setCursor((c) => ({ ...c, visible: true }));
    await waitMs(500);
    await moveTo(refreshBtnRef.current, true, 'center');
    setIsRefreshing(true);
    await waitMs(1100);
    setEvents([...DEMO_EVENTS_LIST]);
    setIsRefreshing(false);
    await waitMs(600);
    setCursor((c) => ({ ...c, visible: false, clicking: false }));
  }, [moveTo]);

  const commitAutoEvent = useCallback(() => {
    const newEvent: Event = {
      id: AUTO_EVENT_ID,
      name: DEMO_FORM_FINAL.name,
      date: DEMO_FORM_FINAL.date,
      location: DEMO_FORM_FINAL.location,
      numberOfDays: DEMO_FORM_FINAL.numberOfDays,
      timezone: DEMO_FORM_FINAL.timezone,
      eventType: DEMO_FORM_FINAL.eventType,
      recordStreaming: DEMO_FORM_FINAL.recordStreaming,
      created_at: new Date().toISOString(),
    };
    setShowAddModal(false);
    setFormData(EMPTY_FORM);
    setActiveField(null);
    setEvents((prev) => [newEvent, ...prev.filter((e) => e.id !== AUTO_EVENT_ID)]);
    setNewEventId(AUTO_EVENT_ID);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (demoRunningRef.current || userPausedRef.current) return;
      demoRunningRef.current = true;

      await waitMs(START_DELAY_MS);
      if (cancelled || userPausedRef.current) return;

      await moveTo(addBtnRef.current, true, 'center');
      if (cancelled) return;
      setShowAddModal(true);
      setFormData(EMPTY_FORM);
      await waitForElement(() => nameInputRef.current);
      await waitMs(500);

      setActiveField('name');
      await moveTo(nameInputRef.current);
      for (let i = 1; i <= DEMO_EVENT_NAME.length; i++) {
        if (cancelled || userPausedRef.current) break;
        setFormData((f) => ({ ...f, name: DEMO_EVENT_NAME.slice(0, i) }));
        await waitMs(TYPING_MS);
      }
      await waitMs(FIELD_PAUSE_MS);

      setActiveField('date');
      await moveTo(dateInputRef.current, true, 'center');
      setFormData((f) => ({ ...f, date: DEMO_FORM_FINAL.date }));
      await waitMs(FIELD_PAUSE_MS);

      setActiveField('location');
      await moveTo(locationSelectRef.current, true, 'center');
      setFormData((f) => ({ ...f, location: DEMO_FORM_FINAL.location }));
      await waitMs(FIELD_PAUSE_MS);

      setActiveField('broadcast');
      await moveTo(broadcastSelectRef.current, true, 'center');
      setFormData((f) => ({ ...f, recordStreaming: DEMO_FORM_FINAL.recordStreaming }));
      await waitMs(FIELD_PAUSE_MS);

      setActiveField('submit');
      await moveTo(submitBtnRef.current, true, 'center');
      if (!cancelled && !userPausedRef.current) {
        commitAutoEvent();
      }

      await waitMs(LOOP_HOLD_MS);
      if (cancelled || userPausedRef.current) return;

      await refreshAndReset();

      demoRunningRef.current = false;
      await waitMs(LOOP_GAP_MS);
      if (!cancelled && !userPausedRef.current) run();
    };

    run();

    return () => {
      cancelled = true;
      demoRunningRef.current = false;
    };
  }, [moveTo, commitAutoEvent, refreshAndReset]);

  const pauseDemoForUser = useCallback(() => {
    userPausedRef.current = true;
    setCursor((c) => ({ ...c, visible: false }));
  }, []);

  const sortedEvents = [...events].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return (
    <div ref={rootRef} className="relative min-h-full bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200 pt-16">
      <ShowcaseFakeCursor
        x={cursor.x}
        y={cursor.y}
        visible={cursor.visible}
        clicking={cursor.clicking}
        moveMs={MOVE_MS}
      />

      <div className="text-center py-3">
        <h1 className="text-xl font-bold text-white mb-0.5">📅 Event List Calendar</h1>
        <p className="text-sm text-slate-400">Manage your events and schedules</p>
      </div>

      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-wrap items-center justify-center gap-3 mb-3">
          <div className="bg-slate-800 rounded-lg p-0.5 flex">
            <span className="px-4 py-2 rounded-md text-sm font-semibold bg-green-600 text-white">
              📅 Upcoming Events
            </span>
            <span className="px-4 py-2 rounded-md text-sm font-semibold text-slate-400">📋 Past Events</span>
            <span className="px-4 py-2 rounded-md text-sm font-semibold text-slate-400">⚡ Quick Mode</span>
          </div>
          <button
            ref={addBtnRef}
            type="button"
            onClick={() => {
              pauseDemoForUser();
              setFormData(DEMO_FORM_FINAL);
              setShowAddModal(true);
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            + Add New Event
          </button>
          <span className="px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg cursor-default">
            Open Quick Mode
          </span>
        </div>

        <div className="flex justify-center mb-4">
          <div className="bg-slate-800 rounded-lg p-3 w-full max-w-4xl">
            <div className="flex items-center gap-4 justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold text-sm">🔍 Search:</span>
                  <div className="w-80 px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-slate-400 text-sm">
                    Search events by name or location…
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold text-sm">📍 Filter by location:</span>
                  <div className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-white text-sm">
                    All Locations
                  </div>
                </div>
              </div>
              <button
                ref={refreshBtnRef}
                type="button"
                onClick={() => pauseDemoForUser()}
                className={`px-3 py-1.5 rounded-lg text-sm text-white transition-colors ${
                  isRefreshing
                    ? 'bg-green-700 ring-2 ring-green-400 animate-pulse'
                    : 'bg-slate-600 hover:bg-slate-500'
                }`}
              >
                {isRefreshing ? '⟳ Refreshing…' : '🔄 Refresh'}
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-slate-400">
              Auto-demo — ends with <strong className="text-slate-300">Refresh</strong> before looping
            </p>
          </div>
        </div>

        <div className={`bg-slate-800 rounded-xl p-4 shadow-2xl transition-opacity duration-300 ${isRefreshing ? 'opacity-45' : 'opacity-100'}`}>
          <div className="bg-slate-800 rounded-lg overflow-hidden border border-slate-600">
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
                    Broadcast
                  </th>
                  <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600">
                    Duration
                  </th>
                  <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600">
                    Timezone
                  </th>
                  <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedEvents.map((event) => (
                  <EventTableRow key={event.id} event={event} isNew={event.id === newEventId} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showAddModal && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg p-4 max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-600">
            <h2 className="text-lg font-bold text-white mb-3 shrink-0">
              <span style={{ filter: 'brightness(0) invert(1)' }}>📅</span> Add New Event
            </h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 overflow-y-auto min-h-0 flex-1 pr-1">
              <div className="col-span-2">
                <label className="block text-slate-300 text-sm font-medium mb-1">Event Name</label>
                <input
                  ref={nameInputRef}
                  type="text"
                  readOnly
                  value={formData.name}
                  placeholder="Enter event name"
                  className={`w-full px-3 py-2 bg-slate-700 border rounded text-white text-sm ${fieldRing(activeField === 'name')}`}
                />
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Date</label>
                <input
                  ref={dateInputRef}
                  type="date"
                  readOnly
                  value={formData.date}
                  className={`w-full px-3 py-2 bg-slate-700 border rounded text-white text-sm ${fieldRing(activeField === 'date')}`}
                  style={{ colorScheme: 'dark' }}
                />
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Location</label>
                <select
                  ref={locationSelectRef}
                  value={formData.location}
                  onChange={(e) => {
                    pauseDemoForUser();
                    setFormData((f) => ({ ...f, location: e.target.value }));
                  }}
                  className={`w-full px-3 py-2 bg-slate-700 border rounded text-white text-sm ${fieldRing(activeField === 'location')}`}
                >
                  {LOCATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Event Type</label>
                <select
                  value={formData.eventType || 'Staged Production'}
                  tabIndex={-1}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm pointer-events-none"
                >
                  {EVENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Broadcast Options</label>
                <select
                  ref={broadcastSelectRef}
                  value={formData.recordStreaming || 'None'}
                  onChange={(e) => {
                    pauseDemoForUser();
                    setFormData((f) => ({ ...f, recordStreaming: e.target.value }));
                  }}
                  className={`w-full px-3 py-2 bg-slate-700 border rounded text-white text-sm ${fieldRing(activeField === 'broadcast')}`}
                >
                  {RECORD_STREAMING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Duration</label>
                <select
                  value={formData.numberOfDays}
                  tabIndex={-1}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm pointer-events-none"
                >
                  {DAYS_OPTIONS.map((days) => (
                    <option key={days} value={days}>
                      {days} day{days > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Timezone</label>
                <select
                  value={formData.timezone || 'America/New_York'}
                  tabIndex={-1}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm pointer-events-none"
                >
                  {TIMEZONE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <footer className="mt-4 pt-4 border-t border-slate-600 shrink-0 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  pauseDemoForUser();
                  setShowAddModal(false);
                  setFormData(EMPTY_FORM);
                }}
                className="flex-1 px-4 py-2.5 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                ref={submitBtnRef}
                type="button"
                onClick={() => {
                  pauseDemoForUser();
                  if (!formData.name.trim() || !formData.date) return;
                  const id = `demo-manual-${Date.now()}`;
                  const newEvent: Event = {
                    id,
                    name: formData.name.trim(),
                    date: formData.date,
                    location: formData.location,
                    numberOfDays: formData.numberOfDays,
                    timezone: formData.timezone,
                    eventType: formData.eventType,
                    recordStreaming: formData.recordStreaming,
                    created_at: new Date().toISOString(),
                  };
                  setShowAddModal(false);
                  setFormData(EMPTY_FORM);
                  setEvents((prev) => [newEvent, ...prev.filter((e) => e.id !== AUTO_EVENT_ID)]);
                  setNewEventId(id);
                }}
                className={`flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors ${
                  activeField === 'submit' ? 'ring-2 ring-blue-300' : ''
                }`}
              >
                Add Event
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};
