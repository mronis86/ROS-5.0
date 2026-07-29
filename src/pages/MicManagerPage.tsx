import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';
import { EventSelectorDropdown } from '../components/EventSelectorDropdown';
import { Event } from '../types/Event';
import {
  formatNameForTwoLines,
  formatSpeakerLocation,
} from '../showcase/photoShowcaseHelpers';
import {
  getMicAssignment,
  MIC_TYPE_OPTIONS,
  MIC_UNIT_MAX,
  micAssignmentKey,
  micNeedsUnit,
  micTypeLabel,
  normalizeMicUnit,
  parseMicAssignmentsPayload,
  resolveMicAssignment,
  seedPodiumAssignments,
  speakersForSlots,
  speakersWithNames,
  type MicAssignment,
  type MicType,
} from '../lib/micManager';

const MIC_TABLE_COLS =
  'minmax(4.5rem,0.85fr) minmax(9rem,1.5fr) repeat(7, minmax(0,1fr))';

type ScheduleItem = {
  id: number;
  day?: number;
  programType?: string;
  segmentName?: string;
  shotType?: string;
  speakersText?: string;
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
  customFields?: { cue?: string; [key: string]: unknown };
};

type ViewMode = 'plan' | 'follow';

const TYPE_COLOR: Record<string, string> = {
  'Podium Transition': '#8B4513',
  'Panel Transition': '#404040',
  'Sub Cue': '#6B7280',
  Video: '#F59E0B',
  'Panel+Remote': '#1E40AF',
  'Remote Only': '#60A5FA',
  'Break F&B/B2B': '#EC4899',
  'Breakout Session': '#20B2AA',
  'Delay Block': '#7C3AED',
  Podium: '#8B4513',
  Panel: '#404040',
  'PreShow/End': '#8B5CF6',
  KILLED: '#DC2626',
};

function formatDelayDuration(item: ScheduleItem): string {
  const h = Math.max(0, Math.floor(Number(item.durationHours) || 0));
  const m = Math.max(0, Math.floor(Number(item.durationMinutes) || 0));
  const s = Math.max(0, Math.floor(Number(item.durationSeconds) || 0));
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function formatCueDisplay(cue: unknown): string {
  const raw = String(cue || '').trim();
  if (!raw) return '';
  return /^cue\b/i.test(raw) ? raw : `CUE ${raw}`;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00:00';
  const isNegative = seconds < 0;
  const abs = Math.abs(Math.floor(seconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `${isNegative ? '-' : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function countdownColor(remaining: number, hasTimer: boolean): string {
  if (!hasTimer) return '#ffffff';
  if (remaining > 120) return '#10b981';
  if (remaining > 30) return '#f59e0b';
  return '#ef4444';
}

function progressColor(remaining: number): string {
  if (remaining < 0) return '#ef4444';
  if (remaining > 120) return '#10b981';
  if (remaining > 30) return '#f59e0b';
  return '#ef4444';
}

const MicManagerPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const q = new URLSearchParams(location.search);
  const eventIdParam = q.get('eventId');

  const [event, setEvent] = useState<Event | null>(() => {
    const fromState = location.state?.event as Event | undefined;
    if (fromState?.id) return fromState;
    if (eventIdParam) {
      return {
        id: eventIdParam,
        name: q.get('eventName') || 'Current Event',
        date: q.get('eventDate') || '',
        location: q.get('eventLocation') || '',
        numberOfDays: 1,
      };
    }
    return null;
  });

  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showEventSelector, setShowEventSelector] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [selectedDay, setSelectedDay] = useState(1);
  const [numberOfDays, setNumberOfDays] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Record<string, MicAssignment>>({});
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('plan');
  const [speakersOnly, setSpeakersOnly] = useState(() => {
    try {
      // Default: All rows. Only Speakers when explicitly saved as '1'.
      return localStorage.getItem('mic-manager-row-filter') === 'speakers';
    } catch {
      return false;
    }
  });
  const [compactView, setCompactView] = useState(() => {
    try {
      return localStorage.getItem('mic-manager-compact') === '1';
    } catch {
      return false;
    }
  });
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [openMicPicker, setOpenMicPicker] = useState<string | null>(null);
  const micPickerRef = useRef<HTMLDivElement | null>(null);

  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerLoaded, setTimerLoaded] = useState(false);
  const [timerProgress, setTimerProgress] = useState({ elapsed: 0, total: 0 });
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);

  const assignmentsRef = useRef(assignments);
  const eventIdRef = useRef(event?.id);
  const startedAtRef = useRef(startedAt);
  const totalRef = useRef(timerProgress.total);
  assignmentsRef.current = assignments;
  eventIdRef.current = event?.id;
  startedAtRef.current = startedAt;
  totalRef.current = timerProgress.total;

  const applyActiveTimer = useCallback((timer: any | null) => {
    if (!timer) {
      setActiveItemId(null);
      setTimerRunning(false);
      setTimerLoaded(false);
      setStartedAt(null);
      setTimerProgress({ elapsed: 0, total: 0 });
      return;
    }
    const itemId = timer.item_id ?? timer.itemId;
    setActiveItemId(itemId != null ? Number(itemId) : null);
    const running = Boolean(timer.is_running && timer.is_active !== false);
    const loaded = Boolean(timer.is_active && !timer.is_running);
    setTimerRunning(running);
    setTimerLoaded(loaded || running);
    const total = Number(timer.duration_seconds || timer.duration || 0);
    const start = timer.started_at || timer.created_at || null;
    setStartedAt(running ? start : null);
    if (running && start) {
      const syncedNow = Date.now() + clockOffset;
      const elapsed = Math.max(0, Math.floor((syncedNow - new Date(start).getTime()) / 1000));
      setTimerProgress({ elapsed, total });
    } else {
      setTimerProgress({ elapsed: 0, total });
    }
  }, [clockOffset]);

  const loadEvents = useCallback(async () => {
    try {
      setEventsLoading(true);
      const calendarEvents = await DatabaseService.getCalendarEvents();
      const mapped: Event[] = (calendarEvents || []).map((calEvent: any) => {
        const dateObj = new Date(calEvent.date);
        return {
          id: calEvent.id || '',
          name: calEvent.name,
          date: dateObj.toISOString().split('T')[0],
          location: calEvent.schedule_data?.location || '',
          numberOfDays: calEvent.schedule_data?.numberOfDays || 1,
        };
      });
      mapped.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      setEvents(mapped.filter((e) => e.id));
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, []);

  const loadSchedule = useCallback(async (eventId: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await DatabaseService.getRunOfShowData(eventId, { bypassCache: true });
      const items = Array.isArray(data?.schedule_items) ? data.schedule_items : [];
      setSchedule(items);
      const days = Number(data?.settings?.numberOfDays) || 1;
      setNumberOfDays(Math.max(1, days));
      setEvent((prev) =>
        prev
          ? {
              ...prev,
              name: data?.event_name || prev.name,
              date: data?.event_date || prev.date,
              numberOfDays: days,
            }
          : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedule');
      setSchedule([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAssignments = useCallback(async (eventId: string) => {
    const raw = await DatabaseService.getMicAssignments(eventId);
    setAssignments(parseMicAssignmentsPayload(raw).assignments);
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!event?.id) return;
    void loadSchedule(event.id);
    void loadAssignments(event.id);
  }, [event?.id, loadSchedule, loadAssignments]);

  useEffect(() => {
    const id = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Live countdown tick when running
  useEffect(() => {
    if (!timerRunning || !startedAt) return;
    const id = window.setInterval(() => {
      const start = startedAtRef.current;
      const total = totalRef.current;
      if (!start) return;
      const syncedNow = Date.now() + clockOffset;
      const elapsed = Math.max(0, Math.floor((syncedNow - new Date(start).getTime()) / 1000));
      setTimerProgress({ elapsed, total });
    }, 250);
    return () => window.clearInterval(id);
  }, [timerRunning, startedAt, clockOffset]);

  useEffect(() => {
    if (!event?.id) return;
    let cancelled = false;

    const refreshActive = async () => {
      try {
        const active = await DatabaseService.getActiveTimer(event.id);
        if (!cancelled) applyActiveTimer(active);
      } catch {
        if (!cancelled) applyActiveTimer(null);
      }
    };

    void refreshActive();

    socketClient.connect(event.id, {
      onConnectionChange: () => {},
      onTimerStarted: (data: any) => applyActiveTimer(data),
      onTimerUpdated: (data: any) => applyActiveTimer(data),
      onTimerStopped: () => applyActiveTimer(null),
      onTimersStopped: () => applyActiveTimer(null),
      onActiveTimersUpdated: (data: any) => {
        const list = Array.isArray(data) ? data : data?.timers || data?.activeTimers || [];
        const running =
          list.find((t: any) => t?.is_running && t?.is_active !== false) ||
          list.find((t: any) => t?.is_active) ||
          null;
        applyActiveTimer(running);
      },
      onRunOfShowDataUpdated: () => {
        if (eventIdRef.current) void loadSchedule(eventIdRef.current);
      },
      onMicAssignmentsUpdate: (data) => {
        if (!data || data.event_id !== eventIdRef.current) return;
        setAssignments(parseMicAssignmentsPayload(data).assignments);
      },
      onInitialSync: async () => {
        if (!eventIdRef.current) return;
        await loadSchedule(eventIdRef.current);
        await loadAssignments(eventIdRef.current);
        await refreshActive();
      },
    });

    return () => {
      cancelled = true;
    };
  }, [event?.id, loadSchedule, loadAssignments, applyActiveTimer]);

  // After schedule + assignments load, auto-seed Lectern/Podium for Podium speakers
  useEffect(() => {
    if (!event?.id || loading || schedule.length === 0) return;
    const seeded = seedPodiumAssignments(schedule, assignments);
    if (!seeded.changed) return;
    setAssignments(seeded.assignments);
    void DatabaseService.saveMicAssignments(event.id, {
      assignments: seeded.assignments,
      changes: [],
    });
  }, [event?.id, loading, schedule, assignments]);

  const persist = useCallback(
    async (nextAssignments: Record<string, MicAssignment>) => {
      if (!event?.id) return;
      setSaving(true);
      await DatabaseService.saveMicAssignments(event.id, {
        assignments: nextAssignments,
        changes: [],
      });
      setSaving(false);
    },
    [event?.id]
  );

  const updateAssignment = useCallback(
    (itemId: number, slot: number, patch: Partial<MicAssignment>) => {
      const key = micAssignmentKey(itemId, slot);
      const prev = getMicAssignment(assignmentsRef.current, itemId, slot);
      const mic = patch.mic !== undefined ? patch.mic : prev.mic;
      const unit =
        patch.unit !== undefined
          ? patch.unit
          : micNeedsUnit(mic)
            ? prev.unit
            : null;
      const nextValue: MicAssignment = {
        mic,
        unit: micNeedsUnit(mic) ? normalizeMicUnit(unit) : null,
      };
      const next = { ...assignmentsRef.current, [key]: nextValue };
      setAssignments(next);
      void persist(next);
    },
    [persist]
  );

  useEffect(() => {
    if (!openMicPicker) return;
    const onPointerDown = (e: MouseEvent) => {
      if (micPickerRef.current && !micPickerRef.current.contains(e.target as Node)) {
        setOpenMicPicker(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMicPicker(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMicPicker]);

  useEffect(() => {
    if (viewMode !== 'plan') setOpenMicPicker(null);
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem('mic-manager-row-filter', speakersOnly ? 'speakers' : 'all');
    } catch {
      /* ignore */
    }
  }, [speakersOnly]);

  useEffect(() => {
    try {
      localStorage.setItem('mic-manager-compact', compactView ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [compactView]);

  const dayItems = useMemo(() => {
    return schedule.filter((item) => {
      if ((item.day || 1) !== selectedDay) return false;
      if (!speakersOnly) return true;
      return speakersWithNames(item.speakersText).length > 0;
    });
  }, [schedule, selectedDay, speakersOnly]);

  const remainingSeconds = timerProgress.total - timerProgress.elapsed;
  const hasTimer = Boolean(activeItemId && (timerRunning || timerLoaded) && timerProgress.total > 0);
  const remainingPct =
    hasTimer && remainingSeconds >= 0 && timerProgress.total > 0
      ? (remainingSeconds / timerProgress.total) * 100
      : hasTimer && remainingSeconds < 0
        ? 0
        : 0;

  const activeCueLabel = useMemo(() => {
    if (activeItemId == null) return '';
    const item = schedule.find((s) => s.id === activeItemId);
    if (item?.customFields?.cue) return formatCueDisplay(item.customFields.cue);
    return `CUE ${activeItemId}`;
  }, [activeItemId, schedule]);

  const statusLine = useMemo(() => {
    if (timerRunning && activeItemId != null) return `RUNNING - ${activeCueLabel}`;
    if (timerLoaded && activeItemId != null) return `LOADED - ${activeCueLabel}`;
    return 'NO CUE SELECTED';
  }, [timerRunning, timerLoaded, activeItemId, activeCueLabel]);

  const statusClass = timerRunning
    ? 'text-green-400'
    : timerLoaded
      ? 'text-yellow-400'
      : 'text-slate-300';

  useEffect(() => {
    if (viewMode !== 'follow' || activeItemId == null) return;
    const el = document.getElementById(`mic-row-${activeItemId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [viewMode, activeItemId, dayItems]);

  const selectEvent = (selected: Event) => {
    setEvent(selected);
    setSelectedDay(1);
    setShowEventSelector(false);
    navigate(
      `/mic-manager?eventId=${encodeURIComponent(selected.id)}&eventName=${encodeURIComponent(selected.name || '')}&eventDate=${encodeURIComponent(selected.date || '')}&eventLocation=${encodeURIComponent(selected.location || '')}`,
      { replace: true, state: { event: selected } }
    );
  };

  const rowHighlight = (itemId: number) => {
    const isActive = activeItemId != null && Number(activeItemId) === Number(itemId);
    if (!isActive) return { border: 'border border-slate-600', bg: 'bg-slate-900' };
    if (timerRunning) return { border: 'border-4 border-green-400', bg: 'bg-green-950' };
    // Loaded cue — same blue treatment as Photo View / operator pages
    return { border: 'border-4 border-blue-400', bg: 'bg-blue-950' };
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Sticky countdown / controls — stays visible while scrolling */}
      <div className="sticky top-0 z-40 bg-slate-900 shadow-[0_10px_20px_rgba(0,0,0,0.4)]">
        <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-3">
          <div className="flex justify-between items-start gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold truncate">{event?.name || 'Mic Manager'}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-2">
                <span className="text-sm text-gray-300">{currentTime.toLocaleTimeString()}</span>
                {saving ? <span className="text-xs text-slate-400">Saving…</span> : null}

                {events.length > 1 && (
                  <div className="overflow-visible relative z-50 flex items-center gap-2">
                    {showEventSelector ? (
                      <>
                        <EventSelectorDropdown
                          events={events}
                          value={event?.id ?? null}
                          onChange={selectEvent}
                          disabled={eventsLoading}
                          loading={eventsLoading}
                          placeholder="Select event…"
                          selectClassName="min-w-[180px] max-w-[280px]"
                        />
                        <button
                          type="button"
                          onClick={() => setShowEventSelector(false)}
                          className="px-2 py-1 text-xs rounded border border-slate-600 bg-slate-700 text-gray-300 hover:bg-slate-600"
                        >
                          Hide
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowEventSelector(true)}
                        className="px-2 py-1 text-xs rounded border border-slate-600 bg-slate-700 text-gray-300 hover:bg-slate-600"
                      >
                        Change event
                      </button>
                    )}
                  </div>
                )}

                {numberOfDays > 1 && (
                  <>
                    <label className="text-sm text-gray-400">Day:</label>
                    <select
                      value={selectedDay}
                      onChange={(e) => setSelectedDay(Number(e.target.value))}
                      className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white"
                    >
                      {Array.from({ length: numberOfDays }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          Day {d}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                <div className="ml-1 flex rounded-lg bg-slate-800 p-0.5 border border-slate-600">
                  <button
                    type="button"
                    onClick={() => setViewMode('plan')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                      viewMode === 'plan' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Plan
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('follow')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                      viewMode === 'follow' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Follow
                  </button>
                </div>

                <div className="flex rounded-lg bg-slate-800 p-0.5 border border-slate-600">
                  <button
                    type="button"
                    onClick={() => setSpeakersOnly(false)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                      !speakersOnly ? 'bg-slate-500 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Show every cue on this day"
                  >
                    All rows
                  </button>
                  <button
                    type="button"
                    onClick={() => setSpeakersOnly(true)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md ${
                      speakersOnly ? 'bg-slate-500 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Only cues that have speakers"
                  >
                    Speakers
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setCompactView((v) => !v)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md border ${
                    compactView
                      ? 'bg-amber-700/80 border-amber-500 text-white'
                      : 'bg-slate-800 border-slate-600 text-slate-300 hover:text-white'
                  }`}
                  title={
                    compactView
                      ? 'Showing compact audio view (no photos)'
                      : 'Hide photos for a denser audio-board view'
                  }
                >
                  {compactView ? 'Compact on' : 'Compact'}
                </button>
              </div>
            </div>

            <div className="flex items-center space-x-6 shrink-0">
              <div className="text-center">
                <div className={`text-lg font-bold ${statusClass}`}>{statusLine}</div>
              </div>
              <div
                className="text-3xl font-mono bg-slate-800 px-6 py-3 rounded-lg border border-slate-600"
                style={{ color: countdownColor(remainingSeconds, hasTimer) }}
              >
                {formatTime(hasTimer ? remainingSeconds : 0)}
              </div>
            </div>
          </div>

          {hasTimer && (
            <div className="mt-3 w-full bg-slate-700 rounded-full overflow-hidden border border-slate-600 relative h-2">
              <div
                className="h-full transition-all duration-300 absolute top-0 right-0"
                style={{
                  width: `${remainingPct}%`,
                  background: progressColor(remainingSeconds),
                }}
              />
            </div>
          )}
        </div>

        {/* Column headers stick with countdown */}
        <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6">
          <div className="overflow-hidden border border-slate-600 bg-slate-700">
            <div className="grid gap-0" style={{ gridTemplateColumns: MIC_TABLE_COLS }}>
              <div className="bg-slate-600 border-r border-slate-600 p-3 text-center font-bold text-sm">
                CUE
              </div>
              <div className="bg-slate-600 border-r border-slate-600 p-3 text-center font-bold text-sm">
                SEGMENT
              </div>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <div
                  key={n}
                  className={`bg-slate-600 p-3 text-center font-bold text-sm ${
                    n < 7 ? 'border-r border-slate-600' : ''
                  }`}
                >
                  SLOT {n}
                </div>
              ))}
            </div>
          </div>

          {/* Breathing room between sticky headers and scrolling rows */}
          <div className="h-2" aria-hidden />
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 pb-4">
      {/* Table body */}
      <div className="w-full">
        {!event?.id ? (
          <div className="text-center text-gray-400 py-12 bg-slate-800 border border-slate-600">
            Select an event to assign mics.
          </div>
        ) : loading ? (
          <div className="text-center text-gray-400 py-12 bg-slate-800 border border-slate-600">
            Loading…
          </div>
        ) : error ? (
          <div className="text-center text-red-300 py-12 bg-slate-800 border border-slate-600">{error}</div>
        ) : dayItems.length === 0 ? (
          <div className="text-center text-gray-400 py-12 bg-slate-800 border border-slate-600">
            {speakersOnly
              ? 'No cues with speakers on this day. Switch to All rows to see the full schedule.'
              : 'No cues on this day.'}
          </div>
        ) : (
          dayItems.map((item) => {
            const isDelayBlock = item.programType === 'Delay Block';
            const cue = String(item.customFields?.cue || (isDelayBlock ? 'DELAY' : `CUE ${item.id}`));
            const ptColor = TYPE_COLOR[item.programType || ''] || '#6B7280';
            const highlight = rowHighlight(item.id);
            const rowPickerOpen = Boolean(
              openMicPicker && String(openMicPicker).startsWith(`${item.id}:`)
            );
            const rowDimmed = Boolean(openMicPicker && !rowPickerOpen);

            if (isDelayBlock) {
              return (
                <div
                  key={item.id}
                  id={`mic-row-${item.id}`}
                  className={`border-2 border-violet-400/70 ${
                    compactView ? 'mb-1.5' : 'mb-3'
                  } last:mb-0 rounded-sm overflow-hidden ${
                    rowDimmed ? 'opacity-30 pointer-events-none' : ''
                  }`}
                >
                  <div
                    className="grid gap-0"
                    style={{
                      minHeight: compactView ? 52 : 64,
                      gridTemplateColumns: MIC_TABLE_COLS,
                      backgroundColor: '#2e1065',
                      backgroundImage:
                        'repeating-linear-gradient(135deg, rgba(167,139,250,0.18) 0, rgba(167,139,250,0.18) 10px, rgba(46,16,101,0.14) 10px, rgba(46,16,101,0.14) 20px)',
                    }}
                  >
                    <div className="border-r border-violet-400/50 p-2 flex flex-col items-center justify-center">
                      <div className="text-sm font-bold text-violet-100">{cue}</div>
                      <div
                        className="mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold text-white border border-violet-300/50"
                        style={{ backgroundColor: ptColor }}
                      >
                        Delay Block
                      </div>
                    </div>
                    <div
                      className="flex items-center justify-center px-3 border-r border-violet-400/40"
                      style={{ gridColumn: '2 / -1' }}
                    >
                      <div className="w-full rounded-md border border-violet-300/70 bg-violet-900/70 px-3 py-2 text-center text-sm font-bold tracking-wide text-violet-50">
                        ⏱ SEGMENT DELAY · {formatDelayDuration(item)} · ALL FOLLOWING START TIMES SHIFTED
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            const slots = speakersForSlots(item.speakersText);
            const canEdit = viewMode === 'plan';

            return (
              <div
                key={item.id}
                id={`mic-row-${item.id}`}
                className={`${highlight.border} ${
                  compactView ? 'mb-1.5' : 'mb-3'
                } last:mb-0 rounded-sm transition-opacity duration-150 ${
                  rowDimmed ? 'opacity-30 pointer-events-none' : ''
                }`}
              >
                <div
                  className={`grid gap-0 ${highlight.bg}`}
                  style={{
                    minHeight: compactView ? 96 : 210,
                    gridTemplateColumns: MIC_TABLE_COLS,
                  }}
                >
                  <div
                    className={`border-r border-slate-600 ${compactView ? 'p-2' : 'p-3'} flex flex-col justify-center transition-opacity duration-150 ${
                      rowPickerOpen ? 'opacity-40' : ''
                    }`}
                  >
                    <div className="text-center">
                      <div className={`${compactView ? 'text-base mb-1.5' : 'text-lg mb-3'} font-bold text-white`}>
                        {cue}
                      </div>
                      <div
                        className={`inline-block px-2 py-1 rounded text-xs font-medium text-white border shadow-lg ${
                          compactView ? 'text-[10px] px-1.5 py-0.5' : ''
                        }`}
                        style={{ backgroundColor: ptColor }}
                      >
                        {item.programType || 'Cue'}
                      </div>
                    </div>
                  </div>

                  <div
                    className={`border-r border-slate-600 ${compactView ? 'p-2' : 'p-3'} flex flex-col justify-center min-w-0 transition-opacity duration-150 ${
                      rowPickerOpen ? 'opacity-40' : ''
                    }`}
                  >
                    {!compactView && <div className="text-gray-400 text-xs mb-1">SEGMENT NAME</div>}
                    <div
                      className={`${compactView ? 'text-sm' : 'text-lg'} font-bold leading-tight text-white break-words`}
                    >
                      {item.segmentName || 'Untitled'}
                    </div>
                    {!compactView && (
                      <>
                        <div className="text-gray-400 text-xs mt-3 mb-1">SHOT TYPE</div>
                        <div className="text-sm font-bold text-white">{item.shotType || '—'}</div>
                      </>
                    )}
                    {compactView && item.shotType ? (
                      <div className="text-[11px] text-slate-400 mt-0.5 truncate">{item.shotType}</div>
                    ) : null}
                  </div>

                  {slots.map((speaker, index) => {
                    const slotNumber = index + 1;
                    const speakerSlot = speaker?.slot || slotNumber;
                    const assignment = speaker
                      ? resolveMicAssignment(assignments, item.id, speakerSlot, speaker.location)
                      : { mic: 'none' as MicType, unit: null };
                    const nameResult = formatNameForTwoLines(speaker?.fullName || '');
                    const unitMissing = micNeedsUnit(assignment.mic) && assignment.unit == null;
                    const pickerKey = micAssignmentKey(item.id, speakerSlot);
                    const isPickerOpen = openMicPicker === pickerKey;
                    const slotDimmed = Boolean(openMicPicker && !isPickerOpen);

                    return (
                      <div
                        key={slotNumber}
                        className={`min-w-0 ${slotNumber < 7 ? 'border-r border-slate-600' : ''} ${
                          compactView ? 'p-1.5' : 'p-2'
                        } flex flex-col transition-opacity duration-150 ${
                          slotDimmed ? 'opacity-30 pointer-events-none' : ''
                        } ${isPickerOpen ? 'relative z-20' : ''}`}
                      >
                        {speaker && (speaker.fullName || speaker.photoLink) ? (
                          <div className="h-full flex flex-col items-center text-center">
                            {!compactView ? (
                              <div className="relative mb-1.5 w-20 h-28 rounded-lg overflow-hidden border-2 border-slate-400 shadow-lg shrink-0">
                                <img
                                  src={speaker.photoLink || '/speaker-placeholder.svg'}
                                  alt={speaker.fullName || `Speaker ${slotNumber}`}
                                  className="h-full w-full object-cover"
                                  style={{ objectFit: 'cover', objectPosition: 'center top' }}
                                  onError={(e) => {
                                    e.currentTarget.onerror = null;
                                    e.currentTarget.src = '/speaker-placeholder.svg';
                                  }}
                                />
                                <div className="absolute inset-x-0 bottom-0 bg-black/80 px-1 py-1 text-[11px] font-semibold leading-tight text-white truncate">
                                  {formatSpeakerLocation(speaker.location)}
                                </div>
                              </div>
                            ) : (
                              <div className="mb-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-700 text-gray-300 truncate max-w-full">
                                {formatSpeakerLocation(speaker.location)}
                              </div>
                            )}
                            <div
                              className={`font-bold text-white ${compactView ? 'mb-1' : 'mb-1.5'} leading-tight ${
                                compactView
                                  ? 'text-[11px]'
                                  : nameResult.needsSmallText
                                    ? 'text-xs'
                                    : 'text-sm'
                              }`}
                              dangerouslySetInnerHTML={{
                                __html: nameResult.html || speaker.fullName || `Slot ${slotNumber}`,
                              }}
                            />

                            <div
                              className="mt-auto w-full relative"
                              ref={isPickerOpen ? micPickerRef : undefined}
                            >
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() =>
                                  setOpenMicPicker((cur) => (cur === pickerKey ? null : pickerKey))
                                }
                                className={`w-full rounded-md border transition-colors ${
                                  compactView ? 'px-1 py-1.5' : 'px-1.5 py-2.5'
                                } ${
                                  !canEdit
                                    ? 'opacity-70 cursor-not-allowed border-slate-600 bg-slate-800 text-white'
                                    : 'border-slate-500 bg-slate-800 text-white hover:bg-slate-700'
                                } ${unitMissing ? 'border-amber-600/70 text-amber-100' : ''} ${
                                  isPickerOpen ? 'border-white/70 bg-slate-700' : ''
                                }`}
                                title={
                                  canEdit
                                    ? 'Set mic type and unit #'
                                    : 'Switch to Plan to edit mics'
                                }
                              >
                                {assignment.mic && assignment.mic !== 'none' ? (
                                  <>
                                    <span
                                      className={`block font-bold leading-tight break-words ${
                                        compactView ? 'text-xs' : 'text-sm'
                                      }`}
                                    >
                                      {micTypeLabel(assignment.mic)}
                                    </span>
                                    {micNeedsUnit(assignment.mic) ? (
                                      <span
                                        className={`mt-0.5 block font-semibold leading-tight ${
                                          compactView ? 'text-[10px]' : 'text-xs'
                                        } ${unitMissing ? 'text-amber-200' : 'text-slate-300'}`}
                                      >
                                        {assignment.unit == null ? 'Unit #?' : `Unit #${assignment.unit}`}
                                      </span>
                                    ) : null}
                                  </>
                                ) : (
                                  <span
                                    className={`block font-bold leading-tight text-slate-400 ${
                                      compactView ? 'text-xs' : 'text-sm'
                                    }`}
                                  >
                                    None
                                  </span>
                                )}
                              </button>

                              {isPickerOpen && canEdit ? (
                                <div
                                  className={`absolute z-30 mt-1 rounded-md border border-slate-500 bg-slate-900 p-2 shadow-2xl ${
                                    micNeedsUnit(assignment.mic) ? 'w-[252px]' : 'w-[148px]'
                                  } ${
                                    slotNumber >= 5
                                      ? 'right-0'
                                      : slotNumber <= 2
                                        ? 'left-0'
                                        : 'left-1/2 -translate-x-1/2'
                                  }`}
                                >
                                  <div
                                    className={`flex gap-2 ${
                                      micNeedsUnit(assignment.mic)
                                        ? slotNumber >= 5
                                          ? 'flex-row-reverse'
                                          : 'flex-row'
                                        : 'flex-col'
                                    }`}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                        Mic
                                      </div>
                                      <div className="flex flex-col gap-1">
                                        {MIC_TYPE_OPTIONS.map((opt) => {
                                          const selected = assignment.mic === opt.value;
                                          return (
                                            <button
                                              key={opt.value}
                                              type="button"
                                              onClick={() => {
                                                const needsUnit = micNeedsUnit(opt.value);
                                                updateAssignment(item.id, speakerSlot, {
                                                  mic: opt.value,
                                                  unit: needsUnit
                                                    ? opt.value === assignment.mic
                                                      ? assignment.unit
                                                      : null
                                                    : null,
                                                });
                                                if (!needsUnit) setOpenMicPicker(null);
                                              }}
                                              className={`rounded px-2 py-1.5 text-left text-[11px] font-semibold leading-tight ${
                                                selected
                                                  ? 'bg-slate-600 text-white ring-1 ring-white/30'
                                                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                                              }`}
                                            >
                                              {opt.label}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>

                                    {micNeedsUnit(assignment.mic) ? (
                                      <div
                                        className={`w-[100px] shrink-0 ${
                                          slotNumber >= 5
                                            ? 'border-r border-slate-700 pr-2'
                                            : 'border-l border-slate-700 pl-2'
                                        }`}
                                      >
                                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                          Unit #
                                        </div>
                                        <div className="grid grid-cols-3 gap-1">
                                          {Array.from({ length: MIC_UNIT_MAX }, (_, i) => i + 1).map(
                                            (n) => {
                                              const selected = assignment.unit === n;
                                              return (
                                                <button
                                                  key={n}
                                                  type="button"
                                                  onClick={() => {
                                                    updateAssignment(item.id, speakerSlot, {
                                                      mic: assignment.mic,
                                                      unit: n,
                                                    });
                                                    setOpenMicPicker(null);
                                                  }}
                                                  className={`rounded py-1.5 text-[11px] font-bold ${
                                                    selected
                                                      ? 'bg-slate-600 text-white ring-1 ring-white/30'
                                                      : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                                                  }`}
                                                >
                                                  {n}
                                                </button>
                                              );
                                            }
                                          )}
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <div className="h-full flex items-center justify-center text-xs text-slate-700">—</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
      </div>
    </div>
  );
};

export default MicManagerPage;
