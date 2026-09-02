import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessCreative } from '../services/auth-service';
import { fetchCreativeEvent } from '../lib/creativeEventApi';
import { stripHtmlNotes, type GuestEventPayload } from '../lib/eventGuestLinks';
import GuestRunOfShowGrid from '../components/guest/GuestRunOfShowGrid';
import GuestSpeakersModal from '../components/guest/GuestSpeakersModal';
import GuestCueDetailModal from '../components/guest/GuestCueDetailModal';
import AppLogo from '../components/AppLogo';
import AppBrandTitle from '../components/AppBrandTitle';
import DisplaySessionDisconnectOverlays from '../components/DisplaySessionDisconnectOverlays';
import { useDisplaySessionDisconnect } from '../hooks/useDisplaySessionDisconnect';
import { creativeDisplaySessionStorageKey } from '../lib/creativeDisplaySession';
import { GUEST_VISIBLE_COLUMNS, ROS_PROGRAM_TYPES } from '../lib/guestRosHelpers';
import {
  buildCreativeExportCsv,
  buildCreativeExportText,
  CREATIVE_EXPORT_FIELD_OPTIONS,
  DEFAULT_CREATIVE_EXPORT_FIELDS,
  downloadTextFile,
  type CreativeExportField,
} from '../lib/creativeRosExport';

const ZOOM_STORAGE_KEY = 'creative-event-zoom';
const COLUMN_FILTER_STORAGE_KEY = 'creative-event-columns';
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 0.85;

type HubTab = 'ros' | 'review';
type SpeakerPanel = 'photos' | 'info';

type CreativeVisibleColumns = typeof GUEST_VISIBLE_COLUMNS;

const COLUMN_TOGGLE_OPTIONS: { key: keyof CreativeVisibleColumns; label: string }[] = [
  { key: 'start', label: 'Start' },
  { key: 'programType', label: 'Program' },
  { key: 'duration', label: 'Duration' },
  { key: 'segmentName', label: 'Segment' },
  { key: 'shotType', label: 'Shot' },
  { key: 'pptQA', label: 'PPT/Q&A' },
  { key: 'notes', label: 'Notes' },
  { key: 'speakers', label: 'Speakers' },
];

function getStoredZoom(): number {
  try {
    const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
    if (raw == null) return ZOOM_DEFAULT;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX) return value;
  } catch {
    /* ignore */
  }
  return ZOOM_DEFAULT;
}

function getStoredColumns(): CreativeVisibleColumns {
  try {
    const raw = localStorage.getItem(COLUMN_FILTER_STORAGE_KEY);
    if (!raw) return { ...GUEST_VISIBLE_COLUMNS };
    const parsed = JSON.parse(raw) as Partial<CreativeVisibleColumns>;
    return { ...GUEST_VISIBLE_COLUMNS, ...parsed };
  } catch {
    return { ...GUEST_VISIBLE_COLUMNS };
  }
}

function dayStartLabel(
  day: number,
  masterStartTime?: string,
  dayStartTimes?: Record<number | string, string>
): string {
  if (dayStartTimes) {
    const keyed = dayStartTimes[day] ?? dayStartTimes[String(day)];
    if (keyed) return keyed;
  }
  return masterStartTime || '—';
}

function safeFileSlug(value: string): string {
  return String(value || 'event')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

const CreativeEventPage: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const eventId = (params.get('eventId') || '').trim();
  const eventNameParam = params.get('eventName') || '';
  const eventDateParam = params.get('eventDate') || '';
  const eventLocationParam = params.get('eventLocation') || '';

  const allowed = canAccessCreative(user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<GuestEventPayload | null>(null);
  const [selectedDay, setSelectedDay] = useState(1);
  const [query, setQuery] = useState('');
  const [zoomLevel, setZoomLevel] = useState<number>(getStoredZoom);
  const [visibleColumns, setVisibleColumns] = useState<CreativeVisibleColumns>(getStoredColumns);
  const [programTypeFilters, setProgramTypeFilters] = useState<string[]>([]);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [exportPanelOpen, setExportPanelOpen] = useState(false);
  const [exportFields, setExportFields] = useState<CreativeExportField[]>(DEFAULT_CREATIVE_EXPORT_FIELDS);
  const [speakersItemId, setSpeakersItemId] = useState<number | null>(null);
  const [speakerPanel, setSpeakerPanel] = useState<SpeakerPanel>('photos');
  const [detailItemId, setDetailItemId] = useState<number | null>(null);
  const [hubTab, setHubTab] = useState<HubTab>('ros');
  const [isRosFullscreen, setIsRosFullscreen] = useState(false);
  const pageRootRef = useRef<HTMLDivElement>(null);
  const loadScheduleRef = useRef<(isRefresh?: boolean) => Promise<void>>(async () => {});

  const creativeSessionStorageKey =
    allowed && eventId && user?.id
      ? creativeDisplaySessionStorageKey(user.id, eventId)
      : null;

  const {
    connectionEnabledRef,
    sessionDisconnected,
    showDisconnectModal,
    showDisconnectNotification,
    disconnectDuration,
    handleDisconnectTimerConfirm,
    handleNeverDisconnect,
    handleReconnect,
  } = useDisplaySessionDisconnect({
    enabled: allowed && !!eventId && !authLoading,
    eventId: eventId || null,
    disconnectSocket: false,
    persistSessionKey: creativeSessionStorageKey,
    onReconnect: () => {
      void loadScheduleRef.current(true);
    },
  });

  const setZoom = useCallback((value: number) => {
    const clamped = Math.max(
      ZOOM_MIN,
      Math.min(ZOOM_MAX, Math.round(value / ZOOM_STEP) * ZOOM_STEP)
    );
    const next = Number(clamped.toFixed(2));
    setZoomLevel(next);
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  const toggleColumn = useCallback((key: keyof CreativeVisibleColumns) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // Keep at least one content column visible
      const anyOn = COLUMN_TOGGLE_OPTIONS.some((opt) => next[opt.key]);
      if (!anyOn) return prev;
      try {
        localStorage.setItem(COLUMN_FILTER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleProgramType = useCallback((type: string) => {
    setProgramTypeFilters((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }, []);

  const toggleExportField = useCallback((field: CreativeExportField) => {
    setExportFields((prev) => {
      if (prev.includes(field)) {
        if (prev.length <= 1) return prev;
        return prev.filter((f) => f !== field);
      }
      return [...prev, field];
    });
  }, []);

  const loadSchedule = useCallback(
    async (isRefresh = false) => {
      if (!eventId) return;
      if (isRefresh && !connectionEnabledRef.current) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const data = await fetchCreativeEvent(eventId);
        if (!data.ok || data.error) {
          setError(data.error || 'Failed to load schedule.');
          if (!isRefresh) setPayload(null);
          return;
        }
        setPayload(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load schedule.');
        if (!isRefresh) setPayload(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [eventId]
  );

  useEffect(() => {
    loadScheduleRef.current = loadSchedule;
  }, [loadSchedule]);

  const openContentReview = useCallback(() => {
    const name = payload?.event?.name || eventNameParam || 'Event';
    navigate(
      `/content-review?eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(name)}&viewer=1`
    );
  }, [eventId, eventNameParam, navigate, payload?.event?.name]);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) {
      navigate('/', { replace: true });
      return;
    }
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    void loadSchedule(false);
  }, [allowed, authLoading, eventId, loadSchedule, navigate]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsRosFullscreen(document.fullscreenElement === pageRootRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleRosFullscreen = useCallback(async () => {
    const el = pageRootRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* Fullscreen may be blocked by browser policy */
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pageRootRef.current && document.fullscreenElement === pageRootRef.current) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  const allItems = payload?.scheduleItems || [];
  const displayEventName = payload?.event?.name || eventNameParam || 'Event';
  const displayDate = payload?.event?.date || eventDateParam;
  const displayLocation = payload?.event?.location || eventLocationParam;
  const masterStartTime = payload?.event?.masterStartTime;
  const dayStartTimes = payload?.event?.dayStartTimes;

  const daysFromItems = useMemo(() => {
    const max = allItems.reduce((acc, item) => Math.max(acc, Number(item.day) || 1), 1);
    return Math.max(1, Number(payload?.event?.numberOfDays) || 1, max);
  }, [allItems, payload?.event?.numberOfDays]);

  const dayItems = useMemo(() => {
    let rows = allItems.filter((item) => (item.day || 1) === selectedDay);
    if (programTypeFilters.length > 0) {
      const allowed = new Set(programTypeFilters);
      rows = rows.filter((item) => allowed.has(String(item.programType || '')));
    }
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((item) => {
      const notes = stripHtmlNotes(item.notes || '').toLowerCase();
      return (
        String(item.cue || '').toLowerCase().includes(q) ||
        String(item.segmentName || '').toLowerCase().includes(q) ||
        String(item.programType || '').toLowerCase().includes(q) ||
        String(item.speakersText || '').toLowerCase().includes(q) ||
        notes.includes(q)
      );
    });
  }, [allItems, selectedDay, query, programTypeFilters]);

  const dayCueTotal = useMemo(
    () => allItems.filter((item) => (item.day || 1) === selectedDay).length,
    [allItems, selectedDay]
  );

  const programTypesInDay = useMemo(() => {
    const set = new Set<string>();
    for (const item of allItems) {
      if ((item.day || 1) !== selectedDay) continue;
      const t = String(item.programType || '').trim();
      if (t) set.add(t);
    }
    const known = ROS_PROGRAM_TYPES.filter((t) => set.has(t));
    const extra = Array.from(set)
      .filter((t) => !ROS_PROGRAM_TYPES.includes(t))
      .sort();
    return [...known, ...extra];
  }, [allItems, selectedDay]);

  const startTimeById = useMemo(() => {
    const map: Record<number, string> = {};
    // Approximate via same day-filtered order as grid uses for display start times.
    // Guest grid computes from full schedule; for export we mirror filtered day rows' starts.
    const dayRows = allItems.filter((item) => (item.day || 1) === selectedDay);
    const dayStart = dayStartLabel(selectedDay, masterStartTime, dayStartTimes);
    if (!dayStart || dayStart === '—') return map;
    const [h0, m0] = dayStart.split(':').map(Number);
    if (!Number.isFinite(h0) || !Number.isFinite(m0)) return map;
    let totalSeconds = 0;
    for (const item of dayRows) {
      if (!item.isIndented) {
        const totalStartSeconds = h0 * 3600 + m0 * 60 + totalSeconds;
        const finalHours = Math.floor(totalStartSeconds / 3600) % 24;
        const finalMinutes = Math.floor((totalStartSeconds % 3600) / 60);
        const date = new Date();
        date.setHours(finalHours, finalMinutes, 0, 0);
        map[item.id] = date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        totalSeconds +=
          (Number(item.durationHours) || 0) * 3600 +
          (Number(item.durationMinutes) || 0) * 60 +
          (Number(item.durationSeconds) || 0);
      } else {
        // Indented cues share parent start — leave blank unless previously set
      }
    }
    return map;
  }, [allItems, selectedDay, masterStartTime, dayStartTimes]);

  const speakersItem = allItems.find((item) => item.id === speakersItemId) || null;
  const detailItem = allItems.find((item) => item.id === detailItemId) || null;
  const selectedDayStart = dayStartLabel(selectedDay, masterStartTime, dayStartTimes);
  const contentWidthClass = isRosFullscreen ? 'max-w-none' : 'max-w-[1800px]';
  const activeFilterCount =
    programTypeFilters.length +
    COLUMN_TOGGLE_OPTIONS.filter((opt) => !visibleColumns[opt.key]).length;

  const runExport = useCallback(
    (format: 'csv' | 'txt') => {
      if (dayItems.length === 0 || exportFields.length === 0) return;
      const stamp = new Date().toISOString().slice(0, 10);
      const base = `${safeFileSlug(displayEventName)}_day${selectedDay}_${stamp}`;
      if (format === 'csv') {
        const csv = buildCreativeExportCsv(dayItems, exportFields, startTimeById);
        downloadTextFile(`${base}.csv`, csv, 'text/csv;charset=utf-8');
      } else {
        const text = buildCreativeExportText(dayItems, exportFields, startTimeById, displayEventName);
        downloadTextFile(`${base}.txt`, text, 'text/plain;charset=utf-8');
      }
    },
    [dayItems, exportFields, startTimeById, displayEventName, selectedDay]
  );

  if (authLoading || !allowed) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-300 flex items-center justify-center">
        Loading…
      </div>
    );
  }

  return (
    <div
      ref={pageRootRef}
      id="creative-ros-reference"
      className={`fixed inset-x-0 bottom-0 z-0 flex flex-col overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200 print:static print:inset-auto print:h-auto print:overflow-visible print:bg-white print:text-black ${
        isRosFullscreen ? 'top-0 z-[200]' : 'top-[var(--app-header-height)]'
      }`}
    >
      <div className="shrink-0 border-b border-slate-700/80 bg-slate-900/95 backdrop-blur print:border-slate-300 print:bg-white">
        {!isRosFullscreen ? (
        <div className={`mx-auto ${contentWidthClass} px-4 py-2.5 flex flex-wrap items-center justify-between gap-3`}>
          <div className="flex items-center gap-3 min-w-0 print:hidden">
            <button
              type="button"
              onClick={() => navigate('/creative')}
              className="shrink-0 rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              ← Events
            </button>
            <AppLogo size="sm" />
            <div className="min-w-0">
              <AppBrandTitle titleClassName="text-sm font-semibold text-white leading-tight" showTagline={false} />
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Schedule reference</p>
            </div>
          </div>
          <div className="text-right min-w-0 flex-1">
            <p className="font-semibold text-white truncate max-w-[min(100vw-2rem,28rem)] print:text-black">
              {displayEventName}
            </p>
            <p className="text-[11px] text-slate-400 print:text-slate-600">
              {[displayDate, displayLocation].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        ) : (
        <div className={`mx-auto ${contentWidthClass} px-4 py-2 flex flex-wrap items-center justify-between gap-2 print:hidden`}>
          <div className="min-w-0">
            <p className="font-semibold text-white truncate">{displayEventName}</p>
            <p className="text-[11px] text-slate-400">
              {[displayDate, displayLocation].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void toggleRosFullscreen()}
            className="shrink-0 rounded-lg border border-slate-500 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            title="Exit fullscreen (Esc)"
          >
            Exit fullscreen
          </button>
        </div>
        )}

        {!isRosFullscreen ? (
        <div className={`mx-auto ${contentWidthClass} px-4 pb-2 flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-2 print:hidden`}>
          <div className="flex rounded-lg border border-slate-600 bg-slate-800/50 p-0.5">
            <button
              type="button"
              onClick={() => setHubTab('ros')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                hubTab === 'ros' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Run of Show
            </button>
            <button
              type="button"
              onClick={() => {
                setHubTab('review');
                openContentReview();
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                hubTab === 'review' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Content Review
            </button>
          </div>
        </div>
        ) : null}

        {payload && hubTab === 'ros' ? (
          <div className={`mx-auto ${contentWidthClass} px-4 pb-2.5 flex flex-wrap items-center gap-2 justify-between border-t border-slate-800/60 pt-2 print:border-slate-200`}>
            <div className="flex flex-wrap items-center gap-2">
              {daysFromItems > 1
                ? Array.from({ length: daysFromItems }, (_, i) => i + 1).map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold print:hidden ${
                        selectedDay === day
                          ? 'bg-violet-600 text-white'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      Day {day}
                    </button>
                  ))
                : null}
              <span className="text-xs text-slate-400 print:text-slate-600">
                Day {selectedDay} · start {selectedDayStart} · {dayCueTotal} cue
                {dayCueTotal === 1 ? '' : 's'}
                {dayItems.length !== dayCueTotal || query.trim() || programTypeFilters.length
                  ? ` · ${dayItems.length} shown`
                  : ''}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={() => {
                  setFilterPanelOpen((v) => !v);
                  setExportPanelOpen(false);
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  filterPanelOpen || activeFilterCount > 0
                    ? 'border-violet-500/70 bg-violet-950/50 text-violet-100'
                    : 'border-slate-600 text-slate-200 hover:bg-slate-800'
                }`}
              >
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExportPanelOpen((v) => !v);
                  setFilterPanelOpen(false);
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                  exportPanelOpen
                    ? 'border-emerald-500/70 bg-emerald-950/40 text-emerald-100'
                    : 'border-slate-600 text-slate-200 hover:bg-slate-800'
                }`}
              >
                Export
              </button>
              <div
                className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900 overflow-hidden"
                title="Zoom schedule to fit more on screen"
              >
                <button
                  type="button"
                  onClick={() => setZoom(zoomLevel - ZOOM_STEP)}
                  disabled={zoomLevel <= ZOOM_MIN}
                  className="px-2.5 py-1.5 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Zoom out"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => setZoom(1)}
                  className="px-2 py-1.5 text-xs font-semibold tabular-nums text-slate-300 hover:bg-slate-800 border-x border-slate-700 min-w-[3.25rem]"
                  title="Reset to 100%"
                >
                  {Math.round(zoomLevel * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => setZoom(zoomLevel + ZOOM_STEP)}
                  disabled={zoomLevel >= ZOOM_MAX}
                  className="px-2.5 py-1.5 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Zoom in"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                onClick={() => void loadSchedule(true)}
                disabled={refreshing || sessionDisconnected}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                title={sessionDisconnected ? 'Reconnect to refresh the schedule' : undefined}
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
              >
                Print
              </button>
              <button
                type="button"
                onClick={() => void toggleRosFullscreen()}
                className="rounded-lg border border-violet-500/60 bg-violet-950/40 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-900/50"
                title="Expand schedule to fullscreen (Esc to exit)"
              >
                {isRosFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              </button>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search schedule…"
                className="min-w-[10rem] max-w-xs rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </div>
          </div>
        ) : null}

        {payload && hubTab === 'ros' && filterPanelOpen ? (
          <div className={`mx-auto ${contentWidthClass} px-4 pb-3 print:hidden`}>
            <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3 space-y-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
                  Show columns
                </p>
                <div className="flex flex-wrap gap-2">
                  {COLUMN_TOGGLE_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => toggleColumn(opt.key)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border ${
                        visibleColumns[opt.key]
                          ? 'border-violet-500 bg-violet-900/40 text-violet-100'
                          : 'border-slate-600 text-slate-500'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {programTypesInDay.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                      Program type
                    </p>
                    {programTypeFilters.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setProgramTypeFilters([])}
                        className="text-[11px] text-slate-400 hover:text-white"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {programTypesInDay.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => toggleProgramType(type)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border ${
                          programTypeFilters.includes(type)
                            ? 'border-amber-500 bg-amber-950/40 text-amber-100'
                            : 'border-slate-600 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <p className="text-[11px] text-slate-500">
                Tip: click a long segment name to open full text with copy, including speakers.
              </p>
            </div>
          </div>
        ) : null}

        {payload && hubTab === 'ros' && exportPanelOpen ? (
          <div className={`mx-auto ${contentWidthClass} px-4 pb-3 print:hidden`}>
            <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">Export filtered cues</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Exports the {dayItems.length} cue{dayItems.length === 1 ? '' : 's'} currently shown
                    (day + search + program filters).
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={dayItems.length === 0}
                    onClick={() => runExport('csv')}
                    className="rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Download CSV
                  </button>
                  <button
                    type="button"
                    disabled={dayItems.length === 0}
                    onClick={() => runExport('txt')}
                    className="rounded-lg border border-emerald-600/70 text-emerald-100 hover:bg-emerald-950/50 disabled:opacity-40 px-3 py-1.5 text-xs font-semibold"
                  >
                    Download text
                  </button>
                </div>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
                  Include fields
                </p>
                <div className="flex flex-wrap gap-2">
                  {CREATIVE_EXPORT_FIELD_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggleExportField(opt.id)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border ${
                        exportFields.includes(opt.id)
                          ? 'border-emerald-500 bg-emerald-950/40 text-emerald-100'
                          : 'border-slate-600 text-slate-500'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-2">
                  Example: leave Cue + Segment name + Speakers on for a speaker run sheet.
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <main className={`flex-1 min-h-0 flex flex-col overflow-hidden mx-auto w-full ${contentWidthClass} px-4 py-3 print:py-0 print:px-2 print:overflow-visible`}>
        {loading && !payload ? (
          <p className="text-slate-400 text-sm">Loading schedule…</p>
        ) : error && !payload ? (
          <div className="rounded-xl border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : payload && hubTab === 'ros' ? (
          <>
            <div
              className="flex-1 min-h-0 flex flex-col print:zoom-[0.85]"
              style={{ zoom: zoomLevel } as React.CSSProperties}
            >
              <GuestRunOfShowGrid
                schedule={allItems}
                filteredItems={dayItems}
                masterStartTime={masterStartTime}
                dayStartTimes={dayStartTimes}
                visibleColumns={visibleColumns}
                onOpenSpeakers={(itemId) => {
                  setSpeakersItemId(itemId);
                  setSpeakerPanel('photos');
                }}
                onViewSegmentDetail={(itemId) => setDetailItemId(itemId)}
              />
            </div>
            <p className="shrink-0 text-center text-[11px] text-slate-500 pt-2 pb-1 print:hidden">
              {isRosFullscreen
                ? 'Fullscreen — press Esc or Exit fullscreen to return'
                : 'Click a segment name to view/copy full text. Use Filters and Export for a custom run sheet.'}
            </p>
          </>
        ) : null}
      </main>

      <GuestSpeakersModal
        open={speakersItemId != null}
        item={speakersItem}
        panel={speakerPanel}
        onPanelChange={setSpeakerPanel}
        onClose={() => setSpeakersItemId(null)}
      />

      <GuestCueDetailModal
        open={detailItemId != null}
        item={detailItem}
        startTime={detailItem ? startTimeById[detailItem.id] : undefined}
        onClose={() => setDetailItemId(null)}
      />

      <DisplaySessionDisconnectOverlays
        showModal={showDisconnectModal}
        showNotification={showDisconnectNotification}
        disconnectDuration={disconnectDuration}
        onConfirm={handleDisconnectTimerConfirm}
        onNever={handleNeverDisconnect}
        onReconnect={handleReconnect}
      />
    </div>
  );
};

export default CreativeEventPage;
