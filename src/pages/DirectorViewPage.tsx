import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/database';
import { apiClient, type UserEventNoteOperator } from '../services/api-client';
import { socketClient } from '../services/socket-client';
import {
  getStoredOperatorName,
  operatorUserId,
  personColumnLabel,
} from '../lib/pinNotesOperator';
import { stripHtmlNotes, type GuestScheduleItem } from '../lib/eventGuestLinks';
import GuestRunOfShowGrid from '../components/guest/GuestRunOfShowGrid';
import GuestSpeakersModal from '../components/guest/GuestSpeakersModal';
import AppLogo from '../components/AppLogo';
import AppBrandTitle from '../components/AppBrandTitle';
import { GUEST_VISIBLE_COLUMNS } from '../lib/guestRosHelpers';
import {
  GUEST_COLUMN_LABELS,
  GUEST_COLUMN_TOGGLE_OPTIONS,
  GUEST_SCROLL_COLUMNS,
  normalizeGuestColumnOrderWithCustom,
  type GuestScrollColumn,
  type GuestVisibleColumns,
} from '../lib/guestColumnPrefs';
import { moveColumnInOrder, parseCustomColumnOrderKey } from '../lib/rosColumnOrder';
import { isIndentedScheduleItem } from '../lib/scheduleStartTime';
import { countdownColorForRemaining } from '../lib/countdownColor';

const NOTES_SOURCE_KEY = 'director-view-notes-source';
const SYNC_COLUMNS_KEY = 'director-view-sync-columns';
const LEFT_WIDTH_KEY = 'director-view-left-width';
const COLUMN_FILTER_KEY = 'director-view-columns';
const CUSTOM_COLUMN_FILTER_KEY = 'director-view-custom-columns';
const STICKY_START_KEY = 'director-view-sticky-start';
const COLUMN_ORDER_KEY = 'director-view-column-order';
const ROS_ZOOM_KEY = 'director-view-zoom';
const NOTES_ZOOM_KEY = 'director-view-notes-zoom';
const SYNC_ZOOM_KEY = 'director-view-sync-zoom';
const SYNC_HEIGHT_KEY = 'director-view-sync-height';
const CHROME_KEY = 'director-view-chrome';
const DOCK_CLOCK_KEY = 'director-view-dock-clock';
const SYNC_CUE_VIEW_KEY = 'director-view-sync-cue-view';
/** Bottom Current/Next strip supports six custom columns inline (especially in Maximize). */
const MAX_SYNC_COLUMNS = 6;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 0.85;
const NOTES_ZOOM_DEFAULT = 1;
const SYNC_ZOOM_DEFAULT = 1;
const SYNC_HEIGHT_MIN = 12;
const SYNC_HEIGHT_MAX = 48;
const SYNC_HEIGHT_DEFAULT = 24;

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Math.abs(totalSeconds)));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function formatHms(totalSeconds: number): string {
  const neg = totalSeconds < 0;
  const s = Math.floor(Math.abs(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const body =
    h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
      : `${m}:${String(r).padStart(2, '0')}`;
  return neg ? `+${body}` : body;
}

function clampZoom(value: number): number {
  const clamped = Math.max(
    ZOOM_MIN,
    Math.min(ZOOM_MAX, Math.round(value / ZOOM_STEP) * ZOOM_STEP)
  );
  return Number(clamped.toFixed(2));
}

function getStoredZoom(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    if (Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX) return value;
  } catch {
    /* ignore */
  }
  return fallback;
}

function getStoredSyncHeight(): number {
  try {
    const value = Number(localStorage.getItem(SYNC_HEIGHT_KEY));
    if (Number.isFinite(value) && value >= SYNC_HEIGHT_MIN && value <= SYNC_HEIGHT_MAX) {
      return Math.round(value);
    }
  } catch {
    /* ignore */
  }
  return SYNC_HEIGHT_DEFAULT;
}

function ScaleStepper({
  label,
  value,
  onChange,
  title,
}: {
  label?: string;
  value: number;
  onChange: (next: number) => void;
  title?: string;
}) {
  return (
    <div
      className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900 overflow-hidden shrink-0"
      title={title}
    >
      {label ? (
        <span className="px-1.5 text-[10px] uppercase tracking-wide text-slate-500 border-r border-slate-700">
          {label}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => onChange(value - ZOOM_STEP)}
        disabled={value <= ZOOM_MIN}
        className="px-2 py-0.5 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
        aria-label={`${label || 'Scale'} down`}
      >
        −
      </button>
      <button
        type="button"
        onClick={() => onChange(1)}
        className="px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-300 hover:bg-slate-800 border-x border-slate-700 min-w-[2.75rem]"
        title="Reset to 100%"
      >
        {Math.round(value * 100)}%
      </button>
      <button
        type="button"
        onClick={() => onChange(value + ZOOM_STEP)}
        disabled={value >= ZOOM_MAX}
        className="px-2 py-0.5 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
        aria-label={`${label || 'Scale'} up`}
      >
        +
      </button>
    </div>
  );
}

type NotesSource = 'mine' | string; // operator user_id
type NotesViewMode = 'plan' | 'follow';
/** What the synced custom-column cards show. */
type SyncCueView = 'both' | 'current' | 'next';

type CustomColumn = { id: string; name: string };

function loadSyncCueView(): SyncCueView {
  try {
    const raw = localStorage.getItem(SYNC_CUE_VIEW_KEY);
    if (raw === 'current' || raw === 'next' || raw === 'both') return raw;
  } catch {
    /* ignore */
  }
  return 'both';
}

type RosRow = {
  id: number;
  day?: number;
  segmentName?: string;
  programType?: string;
  shotType?: string;
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
  speakers?: string;
  speakersText?: string;
  notes?: string;
  assets?: string;
  customFields?: Record<string, unknown>;
  isIndented?: boolean;
  isTimedMarker?: boolean;
  hasPPT?: boolean;
  hasQA?: boolean;
  needsRecording?: boolean;
  isPublic?: boolean;
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toGuestItem(item: RosRow): GuestScheduleItem {
  const custom =
    item.customFields && typeof item.customFields === 'object' ? { ...item.customFields } : {};
  const cueRaw = String(custom.cue || '').trim();
  return {
    id: Number(item.id),
    day: item.day || 1,
    segmentName: item.segmentName || '',
    programType: item.programType || '',
    shotType: item.shotType || '',
    durationHours: Number(item.durationHours) || 0,
    durationMinutes: Number(item.durationMinutes) || 0,
    durationSeconds: Number(item.durationSeconds) || 0,
    speakers: typeof item.speakers === 'string' ? item.speakers : '',
    speakersText: item.speakersText || '',
    notes: item.notes || '',
    assets: item.assets || '',
    customFields: custom,
    cue: cueRaw,
    isIndented: Boolean(item.isIndented || item.isTimedMarker),
    hasPPT: !!item.hasPPT,
    hasQA: !!item.hasQA,
    needsRecording: !!item.needsRecording,
    isPublic: !!item.isPublic,
  };
}

function fieldValue(
  item: RosRow | GuestScheduleItem | null | undefined,
  column: { id: string; name: string }
): string {
  if (!item) return '';
  const fields = item.customFields as Record<string, unknown> | undefined;
  if (!fields) return '';
  const raw = fields[column.id] ?? fields[column.name];
  if (raw == null) return '';
  return stripHtmlNotes(String(raw)).trim();
}

function cueLabel(item: RosRow | GuestScheduleItem | null | undefined): string {
  if (!item) return '—';
  const cue = String((item.customFields as any)?.cue || (item as GuestScheduleItem).cue || '').trim();
  const seg = String(item.segmentName || '').trim();
  if (cue && seg) return `${cue} · ${seg}`;
  return cue || seg || '—';
}

const DirectorViewPage: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const eventId = (params.get('eventId') || '').trim();
  const eventNameParam = params.get('eventName') || 'Director View';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventName, setEventName] = useState(eventNameParam);
  const [schedule, setSchedule] = useState<RosRow[]>([]);
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([]);
  const [masterStartTime, setMasterStartTime] = useState('');
  const [dayStartTimes, setDayStartTimes] = useState<Record<number | string, string>>({});
  const [selectedDay, setSelectedDay] = useState(1);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerLoaded, setTimerLoaded] = useState(false);
  const [timerStartedAt, setTimerStartedAt] = useState<string | null>(null);
  const [timerDurationSeconds, setTimerDurationSeconds] = useState(0);
  const [timerElapsedHint, setTimerElapsedHint] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const [speakersItemId, setSpeakersItemId] = useState<number | null>(null);
  const [speakerPanel, setSpeakerPanel] = useState<'photos' | 'info'>('photos');
  const [query, setQuery] = useState('');
  const [rosZoom, setRosZoom] = useState(() => getStoredZoom(ROS_ZOOM_KEY, ZOOM_DEFAULT));
  const [notesZoom, setNotesZoom] = useState(() =>
    getStoredZoom(NOTES_ZOOM_KEY, NOTES_ZOOM_DEFAULT)
  );
  const [syncZoom, setSyncZoom] = useState(() => getStoredZoom(SYNC_ZOOM_KEY, SYNC_ZOOM_DEFAULT));
  const [syncHeightPct, setSyncHeightPct] = useState(getStoredSyncHeight);
  const [isResizingSyncHeight, setIsResizingSyncHeight] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [columnDragKey, setColumnDragKey] = useState<string | null>(null);
  /** Logo + status/clock strip visible. Off = maximize schedule real estate. */
  const [chromeExpanded, setChromeExpanded] = useState(() => {
    try {
      const raw = localStorage.getItem(CHROME_KEY);
      if (raw === null) return true;
      return raw !== 'false';
    } catch {
      return true;
    }
  });
  /** When chrome is collapsed, show current cue + timer in the bottom-right dock. */
  const [dockClockVisible, setDockClockVisible] = useState(() => {
    try {
      const raw = localStorage.getItem(DOCK_CLOCK_KEY);
      if (raw === null) return true;
      return raw !== 'false';
    } catch {
      return true;
    }
  });
  const [syncCueView, setSyncCueView] = useState<SyncCueView>(loadSyncCueView);

  const [notesSource, setNotesSource] = useState<NotesSource>(() => {
    const saved = localStorage.getItem(NOTES_SOURCE_KEY);
    return saved || 'mine';
  });
  const [notesViewMode, setNotesViewMode] = useState<NotesViewMode>('plan');
  const [operators, setOperators] = useState<UserEventNoteOperator[]>([]);
  const [personalNotes, setPersonalNotes] = useState<Record<number, string>>({});
  const [syncColumnIds, setSyncColumnIds] = useState<string[]>(() =>
    loadJson<string[]>(SYNC_COLUMNS_KEY, []).slice(0, MAX_SYNC_COLUMNS)
  );
  const [leftWidthPct, setLeftWidthPct] = useState(() => {
    const n = Number(localStorage.getItem(LEFT_WIDTH_KEY));
    return Number.isFinite(n) && n >= 18 && n <= 55 ? n : 32;
  });
  const [isResizingPanes, setIsResizingPanes] = useState(false);
  const [showSyncPicker, setShowSyncPicker] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<GuestVisibleColumns>(() => ({
    ...GUEST_VISIBLE_COLUMNS,
    ...loadJson<Partial<GuestVisibleColumns>>(COLUMN_FILTER_KEY, {}),
  }));
  const [visibleCustomColumns, setVisibleCustomColumns] = useState<Record<string, boolean>>(() =>
    loadJson<Record<string, boolean>>(CUSTOM_COLUMN_FILTER_KEY, {})
  );
  // Default pin Start for Director navigation (override only if user saved a preference).
  const [stickyStartColumn, setStickyStartColumn] = useState(() => {
    try {
      const raw = localStorage.getItem(STICKY_START_KEY);
      if (raw === null) return true;
      return raw === 'true';
    } catch {
      return true;
    }
  });
  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    normalizeGuestColumnOrderWithCustom(loadJson<string[] | null>(COLUMN_ORDER_KEY, null), [])
  );

  const notesListRef = useRef<HTMLDivElement>(null);
  const activeNoteRef = useRef<HTMLDivElement>(null);
  const splitRowRef = useRef<HTMLDivElement>(null);
  const panesStackRef = useRef<HTMLDivElement>(null);
  const resizingPanesRef = useRef(false);
  const resizingSyncHeightRef = useRef(false);

  const myOperatorId = useMemo(() => {
    const name = getStoredOperatorName();
    if (name) return operatorUserId(name);
    if (user?.id) return String(user.id);
    return null;
  }, [user?.id]);

  const guestSchedule = useMemo(() => schedule.map(toGuestItem), [schedule]);

  const dayItemsAll = useMemo(
    () => guestSchedule.filter((i) => (i.day || 1) === selectedDay),
    [guestSchedule, selectedDay]
  );

  const dayItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dayItemsAll;
    return dayItemsAll.filter((item) => {
      const hay = [
        item.segmentName,
        item.cue,
        item.programType,
        item.shotType,
        item.notes,
        item.speakersText,
        JSON.stringify(item.customFields || {}),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [dayItemsAll, query]);

  // Keep column order in sync when custom columns load/change.
  useEffect(() => {
    const ids = customColumns.map((c) => c.id);
    setColumnOrder((prev) => {
      const next = normalizeGuestColumnOrderWithCustom(prev, ids);
      if (next.length === prev.length && next.every((k, i) => k === prev[i])) return prev;
      try {
        localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [customColumns]);

  const availableDays = useMemo(() => {
    const days = new Set(guestSchedule.map((i) => i.day || 1));
    if (days.size === 0) days.add(1);
    return Array.from(days).sort((a, b) => a - b);
  }, [guestSchedule]);

  const indentedLookup = useMemo(() => {
    const map: Record<number, boolean> = {};
    for (const item of schedule) {
      if (item.isIndented || item.isTimedMarker) map[item.id] = true;
    }
    return map;
  }, [schedule]);

  const parentDayItems = useMemo(
    () => dayItemsAll.filter((i) => !isIndentedScheduleItem(i, indentedLookup)),
    [dayItemsAll, indentedLookup]
  );

  const { currentItem, nextItem } = useMemo(() => {
    if (parentDayItems.length === 0) {
      return { currentItem: null as GuestScheduleItem | null, nextItem: null as GuestScheduleItem | null };
    }
    let idx = -1;
    if (activeItemId != null) {
      idx = parentDayItems.findIndex((i) => i.id === activeItemId);
      if (idx < 0) {
        // Active may be indented — walk schedule for parent
        const rawIdx = schedule.findIndex((s) => s.id === activeItemId);
        if (rawIdx >= 0) {
          for (let i = rawIdx; i >= 0; i--) {
            const row = schedule[i];
            if (!isIndentedScheduleItem(row, indentedLookup) && (row.day || 1) === selectedDay) {
              idx = parentDayItems.findIndex((p) => p.id === row.id);
              break;
            }
          }
        }
      }
    }
    if (idx < 0) idx = 0;
    return {
      currentItem: parentDayItems[idx] || null,
      nextItem: parentDayItems[idx + 1] || null,
    };
  }, [parentDayItems, activeItemId, schedule, indentedLookup, selectedDay]);

  const loadSchedule = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const data = await DatabaseService.getRunOfShowData(eventId);
      if (!data) {
        setError('No run-of-show data found for this event.');
        setSchedule([]);
        return;
      }
      setSchedule(Array.isArray(data.schedule_items) ? data.schedule_items : []);
      setCustomColumns(
        Array.isArray(data.custom_columns)
          ? data.custom_columns.map((c: any) => ({ id: String(c.id), name: String(c.name || c.id) }))
          : []
      );
      setMasterStartTime(data.settings?.masterStartTime || '');
      setDayStartTimes(data.settings?.dayStartTimes || {});
      if (data.event_name) setEventName(data.event_name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load event');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  const loadNotes = useCallback(async () => {
    if (!eventId) return;
    try {
      const ops = await apiClient.listUserEventNoteOperators(eventId);
      setOperators(ops.operators || []);
    } catch {
      setOperators([]);
    }

    const sourceId =
      notesSource === 'mine' ? myOperatorId : notesSource;
    if (!sourceId) {
      setPersonalNotes({});
      return;
    }
    try {
      const res = await apiClient.getUserEventNotes(eventId, sourceId);
      const map: Record<number, string> = {};
      for (const row of res.notes || []) {
        if ((row.column_key || 'personal') !== 'personal') continue;
        const text = String(row.content || '').trim();
        if (!text) continue;
        map[Number(row.schedule_item_id)] = text;
      }
      setPersonalNotes(map);
    } catch {
      setPersonalNotes({});
    }
  }, [eventId, notesSource, myOperatorId]);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  // Keep the page pinned to the browser viewport (no document scroll).
  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    try {
      localStorage.setItem(NOTES_SOURCE_KEY, notesSource);
    } catch {
      /* ignore */
    }
  }, [notesSource]);

  useEffect(() => {
    try {
      localStorage.setItem(SYNC_COLUMNS_KEY, JSON.stringify(syncColumnIds));
    } catch {
      /* ignore */
    }
  }, [syncColumnIds]);

  useEffect(() => {
    try {
      localStorage.setItem(LEFT_WIDTH_KEY, String(leftWidthPct));
    } catch {
      /* ignore */
    }
  }, [leftWidthPct]);

  useEffect(() => {
    try {
      localStorage.setItem(SYNC_HEIGHT_KEY, String(syncHeightPct));
    } catch {
      /* ignore */
    }
  }, [syncHeightPct]);

  useEffect(() => {
    try {
      localStorage.setItem(CHROME_KEY, chromeExpanded ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, [chromeExpanded]);

  useEffect(() => {
    try {
      localStorage.setItem(DOCK_CLOCK_KEY, dockClockVisible ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, [dockClockVisible]);

  useEffect(() => {
    try {
      localStorage.setItem(SYNC_CUE_VIEW_KEY, syncCueView);
    } catch {
      /* ignore */
    }
  }, [syncCueView]);

  const persistZoom = useCallback((key: string, setter: (v: number) => void, value: number) => {
    const next = clampZoom(value);
    setter(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  const setRosZoomPersisted = useCallback(
    (value: number) => persistZoom(ROS_ZOOM_KEY, setRosZoom, value),
    [persistZoom]
  );
  const setNotesZoomPersisted = useCallback(
    (value: number) => persistZoom(NOTES_ZOOM_KEY, setNotesZoom, value),
    [persistZoom]
  );
  const setSyncZoomPersisted = useCallback(
    (value: number) => persistZoom(SYNC_ZOOM_KEY, setSyncZoom, value),
    [persistZoom]
  );

  const endPaneResize = useCallback((target?: EventTarget | null, pointerId?: number) => {
    if (!resizingPanesRef.current) return;
    resizingPanesRef.current = false;
    setIsResizingPanes(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (target && typeof pointerId === 'number') {
      try {
        (target as HTMLElement).releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const onPaneResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!splitRowRef.current) return;
    resizingPanesRef.current = true;
    setIsResizingPanes(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onPaneResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingPanesRef.current || !splitRowRef.current) return;
    const rect = splitRowRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const next = Math.round(Math.min(55, Math.max(18, pct)));
    setLeftWidthPct((prev) => (prev === next ? prev : next));
  }, []);

  const onPaneResizePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      endPaneResize(e.currentTarget, e.pointerId);
    },
    [endPaneResize]
  );

  const endSyncHeightResize = useCallback((target?: EventTarget | null, pointerId?: number) => {
    if (!resizingSyncHeightRef.current) return;
    resizingSyncHeightRef.current = false;
    setIsResizingSyncHeight(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (target && typeof pointerId === 'number') {
      try {
        (target as HTMLElement).releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const onSyncHeightPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!panesStackRef.current) return;
    resizingSyncHeightRef.current = true;
    setIsResizingSyncHeight(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onSyncHeightPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingSyncHeightRef.current || !panesStackRef.current) return;
    const rect = panesStackRef.current.getBoundingClientRect();
    if (rect.height <= 0) return;
    const fromBottom = rect.bottom - e.clientY;
    const pct = (fromBottom / rect.height) * 100;
    const next = Math.round(Math.min(SYNC_HEIGHT_MAX, Math.max(SYNC_HEIGHT_MIN, pct)));
    setSyncHeightPct((prev) => (prev === next ? prev : next));
  }, []);

  const onSyncHeightPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      endSyncHeightResize(e.currentTarget, e.pointerId);
    },
    [endSyncHeightResize]
  );

  const clearTimerUi = () => {
    setActiveItemId(null);
    setTimerRunning(false);
    setTimerLoaded(false);
    setTimerStartedAt(null);
    setTimerDurationSeconds(0);
    setTimerElapsedHint(0);
  };

  // Live timer sync
  useEffect(() => {
    if (!eventId) return;
    const applyTimer = (timer: any) => {
      if (!timer) {
        clearTimerUi();
        return;
      }
      const id = timer.item_id != null ? Number(timer.item_id) : null;
      setActiveItemId(Number.isFinite(id as number) ? (id as number) : null);
      const running = !!(timer.is_running && timer.is_active) || timer.timer_state === 'running';
      const loaded =
        !running &&
        (!!timer.is_active || timer.timer_state === 'loaded' || timer.timer_state === 'armed');
      setTimerRunning(running);
      setTimerLoaded(loaded);
      setTimerDurationSeconds(
        Number(timer.duration_seconds) ||
          Number(timer.durationSeconds) ||
          0
      );
      setTimerStartedAt(timer.started_at || timer.startedAt || null);
      if (typeof timer.elapsed_seconds === 'number') {
        setTimerElapsedHint(timer.elapsed_seconds);
      } else if (typeof timer.elapsedSeconds === 'number') {
        setTimerElapsedHint(timer.elapsedSeconds);
      }
    };

    socketClient.connect(
      eventId,
      {
        onTimerUpdated: (data: any) => {
          if (data?.item_id != null) applyTimer(data);
          else if (data?.activeTimer) applyTimer(data.activeTimer);
        },
        onTimerStarted: (data: any) => {
          if (data?.item_id != null) applyTimer({ ...data, is_running: true, is_active: true });
        },
        onTimerStopped: () => {
          setTimerRunning(false);
          setTimerLoaded(false);
          setTimerStartedAt(null);
        },
        onTimersStopped: () => clearTimerUi(),
        onActiveTimersUpdated: (data: any) => {
          const list = Array.isArray(data) ? data : data?.timers || data?.activeTimers;
          if (Array.isArray(list) && list.length > 0) applyTimer(list[0]);
          else clearTimerUi();
        },
        onRunOfShowDataUpdated: () => {
          void loadSchedule();
        },
        onServerTime: (data: any) => {
          if (data?.serverTime) {
            const serverMs = new Date(data.serverTime).getTime();
            if (Number.isFinite(serverMs)) setClockOffset(serverMs - Date.now());
          }
        },
      } as any,
      'director-view'
    );

    return () => {
      try {
        socketClient.disconnect(eventId, 'director-view');
      } catch {
        /* ignore */
      }
    };
  }, [eventId, loadSchedule]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);

  const persistStickyStart = useCallback((value: boolean) => {
    setStickyStartColumn(value);
    try {
      localStorage.setItem(STICKY_START_KEY, value ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, []);

  const elapsedSeconds = useMemo(() => {
    if (timerRunning && timerStartedAt) {
      const startMs = new Date(timerStartedAt).getTime();
      if (Number.isFinite(startMs)) {
        return Math.max(0, Math.floor((Date.now() + clockOffset - startMs) / 1000));
      }
    }
    return Math.max(0, Math.floor(timerElapsedHint));
    // tick forces a refresh while running
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerRunning, timerStartedAt, clockOffset, timerElapsedHint, tick]);

  const remainingSeconds = timerDurationSeconds - elapsedSeconds;
  const hasTimer = timerRunning || timerLoaded;
  const remainingPct =
    hasTimer && timerDurationSeconds > 0
      ? Math.max(0, Math.min(100, (Math.max(0, remainingSeconds) / timerDurationSeconds) * 100))
      : 0;
  const statusLabel = timerRunning ? 'RUNNING' : timerLoaded ? 'LOADED' : 'STANDBY';
  const statusClass = timerRunning
    ? 'text-green-400'
    : timerLoaded
      ? 'text-yellow-400'
      : 'text-slate-400';
  const activeFilterCount =
    GUEST_COLUMN_TOGGLE_OPTIONS.filter((opt) => !visibleColumns[opt.key]).length +
    customColumns.filter((col) => visibleCustomColumns[col.id] === false).length;

  const liveCue =
    activeItemId != null
      ? guestSchedule.find((i) => i.id === activeItemId) || null
      : null;

  const toggleSyncColumn = (columnId: string) => {
    setSyncColumnIds((prev) => {
      if (prev.includes(columnId)) return prev.filter((id) => id !== columnId);
      if (prev.length >= MAX_SYNC_COLUMNS) return prev;
      return [...prev, columnId];
    });
  };

  const persistVisibleColumns = useCallback((next: GuestVisibleColumns) => {
    setVisibleColumns(next);
    try {
      localStorage.setItem(COLUMN_FILTER_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const persistVisibleCustomColumns = useCallback((next: Record<string, boolean>) => {
    setVisibleCustomColumns(next);
    try {
      localStorage.setItem(CUSTOM_COLUMN_FILTER_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const persistColumnOrder = useCallback((next: string[]) => {
    setColumnOrder(next);
    try {
      localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const moveScrollColumn = useCallback(
    (from: number, to: number) => {
      persistColumnOrder(moveColumnInOrder(columnOrder, from, to));
    },
    [columnOrder, persistColumnOrder]
  );

  const showAllColumns = useCallback(() => {
    const nextBuiltin = { ...GUEST_VISIBLE_COLUMNS } as GuestVisibleColumns;
    for (const key of GUEST_SCROLL_COLUMNS) nextBuiltin[key] = true;
    persistVisibleColumns(nextBuiltin);
    const nextCustom: Record<string, boolean> = {};
    for (const col of customColumns) nextCustom[col.id] = true;
    persistVisibleCustomColumns(nextCustom);
  }, [customColumns, persistVisibleColumns, persistVisibleCustomColumns]);

  const hideAllColumns = useCallback(() => {
    const nextBuiltin = { ...visibleColumns };
    for (const key of GUEST_SCROLL_COLUMNS) nextBuiltin[key] = false;
    // Keep at least one built-in so the grid isn't empty of scroll cells.
    nextBuiltin.segmentName = true;
    persistVisibleColumns(nextBuiltin);
    const nextCustom: Record<string, boolean> = {};
    for (const col of customColumns) nextCustom[col.id] = false;
    persistVisibleCustomColumns(nextCustom);
  }, [customColumns, persistVisibleColumns, persistVisibleCustomColumns, visibleColumns]);

  const notesRows = useMemo(() => {
    if (notesViewMode === 'follow') {
      const idx =
        activeItemId != null ? dayItemsAll.findIndex((i) => i.id === activeItemId) : -1;
      const start = idx >= 0 ? idx : 0;
      return [0, 1, 2, 3]
        .map((offset) => dayItemsAll[start + offset])
        .filter(Boolean)
        .map((item, rowIndex) => ({
          item,
          note: personalNotes[item.id] || '',
          isCurrent:
            item.id === currentItem?.id ||
            (activeItemId != null && item.id === activeItemId),
          followLabel: rowIndex === 0 ? 'Current' : `Next ${rowIndex}`,
        }));
    }
    return dayItemsAll
      .filter((item) => personalNotes[item.id])
      .map((item) => ({
        item,
        note: personalNotes[item.id],
        isCurrent: currentItem?.id === item.id,
        followLabel: currentItem?.id === item.id ? 'Current' : '',
      }));
  }, [dayItemsAll, personalNotes, currentItem?.id, notesViewMode, activeItemId]);

  useEffect(() => {
    if (notesViewMode !== 'follow' || activeItemId == null) return;
    activeNoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [notesViewMode, activeItemId, notesRows]);

  const syncColumns = useMemo(
    () =>
      syncColumnIds
        .map((id) => customColumns.find((c) => c.id === id))
        .filter(Boolean) as CustomColumn[],
    [syncColumnIds, customColumns]
  );

  if (!eventId) {
    return (
      <div className="fixed inset-0 z-40 bg-slate-950 text-slate-200 flex items-center justify-center p-6 overflow-hidden">
        <p>Missing eventId. Open Director View from Run of Show → Operator Actions.</p>
      </div>
    );
  }

  const timerDisplay = hasTimer
    ? remainingSeconds < 0
      ? formatHms(remainingSeconds)
      : formatClock(remainingSeconds)
    : '—:—';
  const timerColor = hasTimer
    ? countdownColorForRemaining(remainingSeconds, { isRunning: timerRunning })
    : '#64748b';

  const syncColumnPicker = (
    <div className="flex flex-wrap gap-1.5 items-center">
      {customColumns.length === 0 ? (
        <span className="text-xs text-slate-500">No custom columns</span>
      ) : (
        customColumns.map((col) => {
          const on = syncColumnIds.includes(col.id);
          const disabled = !on && syncColumnIds.length >= MAX_SYNC_COLUMNS;
          return (
            <button
              key={col.id}
              type="button"
              disabled={disabled}
              onClick={() => toggleSyncColumn(col.id)}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                on
                  ? 'bg-sky-700 border-sky-500 text-white'
                  : 'bg-slate-800 border-slate-600 text-slate-300 disabled:opacity-40'
              }`}
              title={
                on
                  ? `Hide ${col.name} from sync strip`
                  : `Show ${col.name} in sync strip (max ${MAX_SYNC_COLUMNS})`
              }
            >
              {col.name}
            </button>
          );
        })
      )}
    </div>
  );

  const syncCueViewToggle = (
    <div
      className="flex rounded-lg bg-slate-800 p-0.5 border border-slate-600 shrink-0"
      title="Show Current, Next, or both in synced custom columns"
    >
      {(
        [
          { id: 'both', label: 'Both' },
          { id: 'current', label: 'Current' },
          { id: 'next', label: 'Next' },
        ] as const
      ).map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => setSyncCueView(opt.id)}
          className={`px-2 py-1 text-[11px] font-semibold rounded-md ${
            syncCueView === opt.id
              ? opt.id === 'both'
                ? 'bg-amber-600 text-white'
                : opt.id === 'current'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-sky-600 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  const syncStripTitle =
    syncCueView === 'current'
      ? 'Synced · Current'
      : syncCueView === 'next'
        ? 'Synced · Next'
        : 'Synced · Current & Next';

  const renderSyncColumnCard = (col: CustomColumn) => {
    const showCurrent = syncCueView === 'both' || syncCueView === 'current';
    const showNext = syncCueView === 'both' || syncCueView === 'next';
    return (
      <div
        key={col.id}
        className="rounded-lg border border-slate-600 bg-slate-950/80 p-2 min-h-0 min-w-0 flex flex-col overflow-hidden"
      >
        <div className="flex-shrink-0 text-[11px] font-bold uppercase tracking-wide text-sky-400 truncate mb-1">
          {col.name}
        </div>
        <div
          className={`flex-1 min-h-0 gap-1 overflow-hidden ${
            showCurrent && showNext ? 'grid grid-rows-2' : 'flex flex-col'
          }`}
        >
          {showCurrent ? (
            <div
              className={`min-h-0 overflow-y-auto ${
                showNext ? '' : 'flex-1'
              }`}
            >
              <div className="text-[10px] font-semibold text-emerald-400 uppercase mb-0.5">
                Current
              </div>
              <div className="text-sm text-white whitespace-pre-wrap break-words">
                {fieldValue(currentItem, col) || <span className="text-slate-600">—</span>}
              </div>
            </div>
          ) : null}
          {showNext ? (
            <div
              className={`min-h-0 overflow-y-auto ${
                showCurrent ? 'border-t border-slate-800 pt-1' : 'flex-1'
              }`}
            >
              <div className="text-[10px] font-semibold text-amber-400/90 uppercase mb-0.5">
                Next
              </div>
              <div className="text-sm text-slate-200 whitespace-pre-wrap break-words">
                {fieldValue(nextItem, col) || <span className="text-slate-600">—</span>}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-950 text-slate-100 flex flex-col overflow-hidden">
      {chromeExpanded ? (
        <>
          <header className="flex-shrink-0 border-b border-slate-700 bg-slate-900/95 px-3 py-1.5 flex items-center gap-3 min-h-0">
            <AppLogo size="sm" />
            <div className="min-w-0 flex-1">
              <AppBrandTitle
                titleClassName="text-xs font-semibold text-slate-400 leading-tight"
                showTagline={false}
              />
              <h1 className="text-sm font-semibold text-white truncate">
                Director View · {eventName}
              </h1>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <label className="text-xs text-slate-400 flex items-center gap-1 whitespace-nowrap">
                Notes
                <select
                  value={notesSource}
                  onChange={(e) => setNotesSource(e.target.value)}
                  className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white max-w-[9rem]"
                >
                  <option value="mine">My notes</option>
                  {operators.map((op) => (
                    <option key={op.user_id} value={op.user_id}>
                      {personColumnLabel(op.user_name || op.user_id)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setShowSyncPicker((v) => !v)}
                className="px-2.5 py-1 text-sm rounded border border-slate-600 bg-slate-800 hover:bg-slate-700 whitespace-nowrap"
              >
                Sync ({syncColumnIds.length}/{MAX_SYNC_COLUMNS})
              </button>
              <button
                type="button"
                onClick={() => {
                  void loadSchedule();
                  void loadNotes();
                }}
                className="px-2.5 py-1 text-sm rounded border border-slate-600 bg-slate-800 hover:bg-slate-700"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setChromeExpanded(false)}
                className="px-2.5 py-1 text-sm rounded border border-amber-600/70 bg-amber-950/40 hover:bg-amber-900/50 text-amber-100 whitespace-nowrap"
                title="Hide logo and clock bar to free space"
              >
                Maximize
              </button>
            </div>
          </header>

          <div className="flex-shrink-0 border-b border-slate-700 bg-slate-900/90 px-3 py-2">
            <div className="flex items-center justify-between gap-4 min-w-0">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">
                  Current cue
                </p>
                <p className="text-base font-semibold text-white truncate">
                  {liveCue?.segmentName || 'No cue loaded'}
                </p>
                <p className="text-xs text-slate-400 font-mono truncate">
                  {liveCue?.cue ? `CUE ${liveCue.cue}` : '—'}
                  {liveCue?.programType ? ` · ${liveCue.programType}` : ''}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-bold ${statusClass}`}>{statusLabel}</p>
                <p
                  className="text-3xl font-mono font-bold tabular-nums leading-none mt-0.5"
                  style={{ color: timerColor }}
                >
                  {timerDisplay}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {timerRunning ? 'Remaining' : timerLoaded ? 'Loaded' : 'Standby'}
                </p>
              </div>
            </div>
            {hasTimer ? (
              <div className="mt-2 w-full bg-slate-700 rounded-full overflow-hidden border border-slate-600 relative h-2">
                <div
                  className="h-full transition-all duration-300 absolute top-0 right-0"
                  style={{
                    width: `${remainingPct}%`,
                    background: timerColor,
                  }}
                />
              </div>
            ) : null}
          </div>

          {showSyncPicker ? (
            <div className="flex-shrink-0 border-b border-slate-700 bg-slate-900 px-3 py-2 max-h-[18vh] overflow-y-auto">
              <p className="text-xs text-slate-400 mb-2">
                Choose up to {MAX_SYNC_COLUMNS} custom columns for the bottom Current / Next strip.
              </p>
              {syncColumnPicker}
            </div>
          ) : null}
        </>
      ) : null}

      {loading ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-slate-400">Loading…</div>
      ) : error ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-red-300 px-4 overflow-auto">
          {error}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Day selector — ROS Filter / Scale / Search live on the schedule pane */}
          <div className="flex-shrink-0 border-b border-slate-800 bg-slate-950/80 px-3 py-1.5 flex flex-wrap items-center gap-2 justify-between">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              {availableDays.length > 1
                ? availableDays.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSelectedDay(d)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                        selectedDay === d
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      Day {d}
                    </button>
                  ))
                : null}
              <span className="text-xs text-slate-500">{dayItems.length} cues</span>
              {!chromeExpanded ? (
                <span className="text-xs text-slate-500 truncate hidden sm:inline">
                  {eventName}
                </span>
              ) : null}
            </div>
            {!chromeExpanded ? (
              <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                <label className="text-xs text-slate-400 flex items-center gap-1 whitespace-nowrap">
                  Notes
                  <select
                    value={notesSource}
                    onChange={(e) => setNotesSource(e.target.value)}
                    className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white max-w-[9rem]"
                  >
                    <option value="mine">My notes</option>
                    {operators.map((op) => (
                      <option key={op.user_id} value={op.user_id}>
                        {personColumnLabel(op.user_name || op.user_id)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setDockClockVisible((v) => !v)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded border whitespace-nowrap ${
                    dockClockVisible
                      ? 'border-emerald-500/70 bg-emerald-950/40 text-emerald-100'
                      : 'border-slate-600 bg-slate-800 text-slate-300'
                  }`}
                  title="Show current cue + timer in the bottom-right dock"
                >
                  Dock clock {dockClockVisible ? 'on' : 'off'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void loadSchedule();
                    void loadNotes();
                  }}
                  className="px-2.5 py-1 text-xs rounded border border-slate-600 bg-slate-800 hover:bg-slate-700"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setChromeExpanded(true)}
                  className="px-2.5 py-1 text-xs font-semibold rounded border border-slate-500 bg-slate-800 hover:bg-slate-700 text-slate-100 whitespace-nowrap"
                  title="Show logo and clock bar again"
                >
                  Show header
                </button>
              </div>
            ) : null}
          </div>

          {/* Notes + ROS + Sync height stack */}
          <div ref={panesStackRef} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div ref={splitRowRef} className="flex-1 min-h-0 flex overflow-hidden">
            <aside
              className="min-h-0 min-w-0 flex flex-col overflow-hidden"
              style={{ flex: `0 0 ${leftWidthPct}%`, width: `${leftWidthPct}%` }}
            >
              <div className="flex-shrink-0 px-3 py-1.5 border-b border-slate-700 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-sky-300">Personal notes</h2>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <div className="flex rounded-lg bg-slate-800 p-0.5 border border-slate-600">
                    <button
                      type="button"
                      onClick={() => setNotesViewMode('plan')}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md ${
                        notesViewMode === 'plan'
                          ? 'bg-cyan-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Free scroll — all notes with content"
                    >
                      Scroll
                    </button>
                    <button
                      type="button"
                      onClick={() => setNotesViewMode('follow')}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md ${
                        notesViewMode === 'follow'
                          ? 'bg-purple-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Follow live cue plus the next three"
                    >
                      Follow
                    </button>
                  </div>
                  <ScaleStepper
                    label="Scale"
                    value={notesZoom}
                    onChange={setNotesZoomPersisted}
                    title="Scale personal notes"
                  />
                </div>
              </div>
              <div
                ref={notesListRef}
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 space-y-2"
                style={
                  notesZoom !== 1
                    ? ({ zoom: notesZoom } as React.CSSProperties)
                    : undefined
                }
              >
                {notesSource === 'mine' && !myOperatorId ? (
                  <p className="text-sm text-slate-500 p-2">
                    Set an operator name in Notes popout first, or sign in, to load My notes.
                  </p>
                ) : notesRows.length === 0 ? (
                  <p className="text-sm text-slate-500 p-2">
                    {notesViewMode === 'follow'
                      ? 'No cues for this day.'
                      : 'No personal notes for this day.'}
                  </p>
                ) : (
                  notesRows.map(({ item, note, isCurrent, followLabel }) => (
                    <div
                      key={item.id}
                      ref={isCurrent ? activeNoteRef : undefined}
                      className={`rounded-lg border px-3 py-2 ${
                        isCurrent
                          ? 'border-emerald-500 bg-emerald-950/40'
                          : 'border-slate-700 bg-slate-900/80'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1 min-w-0">
                        {followLabel ? (
                          <span
                            className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${
                              isCurrent
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-600 text-slate-200'
                            }`}
                          >
                            {followLabel}
                          </span>
                        ) : null}
                        <div className="text-xs font-semibold text-slate-300 truncate min-w-0">
                          {cueLabel(item)}
                        </div>
                      </div>
                      <div className="text-sm text-slate-100 whitespace-pre-wrap break-words">
                        {note || <span className="text-slate-600">—</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>

            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize notes and schedule"
              aria-valuenow={leftWidthPct}
              aria-valuemin={18}
              aria-valuemax={55}
              tabIndex={0}
              onPointerDown={onPaneResizePointerDown}
              onPointerMove={onPaneResizePointerMove}
              onPointerUp={onPaneResizePointerUp}
              onPointerCancel={onPaneResizePointerUp}
              onDoubleClick={() => setLeftWidthPct(32)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setLeftWidthPct((p) => Math.max(18, p - 2));
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  setLeftWidthPct((p) => Math.min(55, p + 2));
                } else if (e.key === 'Home') {
                  e.preventDefault();
                  setLeftWidthPct(18);
                } else if (e.key === 'End') {
                  e.preventDefault();
                  setLeftWidthPct(55);
                }
              }}
              className={`relative flex-shrink-0 w-2 cursor-col-resize touch-none group ${
                isResizingPanes ? 'bg-blue-500' : 'bg-slate-700 hover:bg-blue-500/80'
              }`}
              title="Drag to resize · double-click resets to 32%"
            >
              <div className="pointer-events-none absolute inset-y-0 -left-1 -right-1" />
              <div
                className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-10 w-1 rounded-full ${
                  isResizingPanes ? 'bg-white' : 'bg-slate-400 group-hover:bg-white'
                }`}
              />
            </div>

            {/* overflow-hidden so sticky #/CUE/Start scroll inside the grid, not this pane */}
            <main className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
              <div className="flex-shrink-0 px-2 pt-2 pb-1.5 flex flex-wrap items-center gap-2 justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFilterPanelOpen((v) => !v)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                      filterPanelOpen || activeFilterCount > 0 || stickyStartColumn
                        ? 'border-blue-500/70 bg-blue-950/50 text-blue-100'
                        : 'border-slate-600 text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    Filter Columns{activeFilterCount > 0 ? ` (${activeFilterCount} hidden)` : ''}
                  </button>
                  <ScaleStepper
                    label="ROS"
                    value={rosZoom}
                    onChange={setRosZoomPersisted}
                    title="Scale run of show"
                  />
                </div>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search schedule…"
                  className="min-w-[8rem] max-w-xs w-48 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              {filterPanelOpen ? (
                <div className="flex-shrink-0 mx-2 mb-1.5 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 max-h-[32vh] overflow-y-auto space-y-3">
                  <p className="text-slate-400 text-xs">
                    Toggle columns left-to-right (same order as the schedule). Drag chips or use ← →
                    to reorder. # and CUE stay fixed on the left.
                  </p>
                  <div className="flex flex-wrap gap-2 items-stretch content-start">
                    {columnOrder.map((key, index) => {
                      const customId = parseCustomColumnOrderKey(key);
                      const customCol = customId
                        ? customColumns.find((c) => c.id === customId)
                        : null;
                      if (customId && !customCol) return null;

                      const label = customCol
                        ? customCol.name
                        : GUEST_COLUMN_LABELS[key as GuestScrollColumn] || key;
                      const checked = customId
                        ? visibleCustomColumns[customId] !== false
                        : Boolean(visibleColumns[key as GuestScrollColumn]);

                      return (
                        <div
                          key={key}
                          draggable
                          onDragStart={() => setColumnDragKey(key)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (!columnDragKey || columnDragKey === key) return;
                            const from = columnOrder.indexOf(columnDragKey);
                            const to = columnOrder.indexOf(key);
                            if (from >= 0 && to >= 0) moveScrollColumn(from, to);
                            setColumnDragKey(null);
                          }}
                          onDragEnd={() => setColumnDragKey(null)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 max-w-full ${
                            checked
                              ? 'border-blue-500/70 bg-blue-950/50 text-blue-50'
                              : 'border-slate-600 bg-slate-700/50 text-slate-400'
                          } ${columnDragKey === key ? 'opacity-60 ring-1 ring-blue-400' : ''}`}
                        >
                          <span
                            className="cursor-grab text-slate-500 select-none text-xs"
                            title="Drag to reorder"
                            aria-hidden
                          >
                            ⋮⋮
                          </span>
                          <label className="inline-flex items-center gap-1.5 cursor-pointer min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (customId) {
                                  persistVisibleCustomColumns({
                                    ...visibleCustomColumns,
                                    [customId]: e.target.checked,
                                  });
                                } else {
                                  const next = {
                                    ...visibleColumns,
                                    [key]: e.target.checked,
                                  } as GuestVisibleColumns;
                                  const anyOn = GUEST_COLUMN_TOGGLE_OPTIONS.some(
                                    (opt) => next[opt.key]
                                  );
                                  if (!anyOn) return;
                                  persistVisibleColumns(next);
                                }
                              }}
                              className="rounded flex-shrink-0"
                            />
                            <span
                              className="text-sm font-medium truncate max-w-[10rem]"
                              title={label}
                            >
                              {label}
                            </span>
                            {customCol ? (
                              <span className="text-[10px] uppercase tracking-wide text-slate-500 flex-shrink-0">
                                custom
                              </span>
                            ) : null}
                          </label>
                          <div className="inline-flex items-center flex-shrink-0 border-l border-slate-600/80 pl-1 ml-0.5">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => moveScrollColumn(index, index - 1)}
                              className="px-1 py-0.5 text-slate-300 hover:text-white disabled:opacity-30 text-xs"
                              title="Move left"
                            >
                              ←
                            </button>
                            <button
                              type="button"
                              disabled={index === columnOrder.length - 1}
                              onClick={() => moveScrollColumn(index, index + 1)}
                              className="px-1 py-0.5 text-slate-300 hover:text-white disabled:opacity-30 text-xs"
                              title="Move right"
                            >
                              →
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <label
                    className={`flex items-start gap-2 text-sm ${
                      !visibleColumns.start ? 'opacity-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="rounded mt-0.5"
                      checked={stickyStartColumn}
                      disabled={!visibleColumns.start}
                      onChange={(e) => persistStickyStart(e.target.checked)}
                    />
                    <span className="text-slate-200">
                      Pin Start next to CUE
                      <span className="block text-xs text-slate-500">
                        # / CUE / Start stay fixed while other columns scroll
                      </span>
                    </span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={showAllColumns}
                      className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white font-medium rounded text-xs"
                    >
                      Show All
                    </button>
                    <button
                      type="button"
                      onClick={hideAllColumns}
                      className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white font-medium rounded text-xs"
                    >
                      Hide All
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        persistColumnOrder(
                          normalizeGuestColumnOrderWithCustom(
                            null,
                            customColumns.map((c) => c.id)
                          )
                        )
                      }
                      className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white font-medium rounded text-xs"
                      title="Restore default left-to-right column order"
                    >
                      Reset Order
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterPanelOpen(false)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded text-xs"
                    >
                      Apply Filters
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="flex-1 min-h-0 overflow-hidden px-2 pb-2 flex flex-col">
                <GuestRunOfShowGrid
                  schedule={guestSchedule}
                  filteredItems={dayItems}
                  masterStartTime={masterStartTime}
                  dayStartTimes={dayStartTimes}
                  activeItemId={activeItemId}
                  timerRunning={timerRunning}
                  timerLoaded={timerLoaded}
                  visibleColumns={visibleColumns}
                  stickyStartColumn={stickyStartColumn}
                  columnOrder={columnOrder}
                  customColumns={customColumns}
                  visibleCustomColumns={visibleCustomColumns}
                  zoom={rosZoom}
                  onOpenSpeakers={(id) => setSpeakersItemId(id)}
                />
              </div>
            </main>
          </div>

          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize synced strip height"
            aria-valuenow={syncHeightPct}
            aria-valuemin={SYNC_HEIGHT_MIN}
            aria-valuemax={SYNC_HEIGHT_MAX}
            tabIndex={0}
            onPointerDown={onSyncHeightPointerDown}
            onPointerMove={onSyncHeightPointerMove}
            onPointerUp={onSyncHeightPointerUp}
            onPointerCancel={onSyncHeightPointerUp}
            onDoubleClick={() => setSyncHeightPct(SYNC_HEIGHT_DEFAULT)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSyncHeightPct((p) => Math.min(SYNC_HEIGHT_MAX, p + 2));
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSyncHeightPct((p) => Math.max(SYNC_HEIGHT_MIN, p - 2));
              } else if (e.key === 'Home') {
                e.preventDefault();
                setSyncHeightPct(SYNC_HEIGHT_MIN);
              } else if (e.key === 'End') {
                e.preventDefault();
                setSyncHeightPct(SYNC_HEIGHT_MAX);
              }
            }}
            className={`relative flex-shrink-0 h-2 cursor-row-resize touch-none group ${
              isResizingSyncHeight ? 'bg-amber-500' : 'bg-slate-700 hover:bg-amber-500/80'
            }`}
            title="Drag up/down to resize synced strip · double-click resets"
          >
            <div className="pointer-events-none absolute inset-x-0 -top-1 -bottom-1" />
            <div
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-1 rounded-full ${
                isResizingSyncHeight ? 'bg-white' : 'bg-slate-400 group-hover:bg-white'
              }`}
            />
          </div>

          {/* Bottom strip — height from drag handle above */}
          <section
            className="min-h-0 flex flex-col overflow-hidden border-t border-slate-700 bg-slate-900/95 px-3 py-2"
            style={{ flex: `0 0 ${syncHeightPct}%`, height: `${syncHeightPct}%` }}
          >
            <div className="flex-shrink-0 flex items-center justify-between gap-2 mb-1.5 min-w-0 flex-wrap">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <h2 className="text-sm font-semibold text-amber-300 whitespace-nowrap">
                  {syncStripTitle}
                </h2>
                <span className="text-[10px] tabular-nums text-slate-500">{syncHeightPct}% tall</span>
                {syncCueViewToggle}
                {chromeExpanded ? (
                  <span className="text-xs text-slate-500 truncate min-w-0 hidden lg:inline">
                    Now: {cueLabel(currentItem)}
                    {nextItem ? ` → Next: ${cueLabel(nextItem)}` : ''}
                  </span>
                ) : null}
                <ScaleStepper
                  label="Scale"
                  value={syncZoom}
                  onChange={setSyncZoomPersisted}
                  title="Scale synced custom column cards"
                />
              </div>
              {!chromeExpanded ? (
                <div className="min-w-0 flex items-center gap-2 flex-wrap justify-end">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                    Columns · up to {MAX_SYNC_COLUMNS}
                  </span>
                  {syncColumnPicker}
                </div>
              ) : null}
            </div>

            {chromeExpanded && syncColumns.length === 0 ? (
              <p className="text-sm text-slate-500 flex-shrink-0">
                Open Sync and pick up to {MAX_SYNC_COLUMNS} custom fields.
              </p>
            ) : !chromeExpanded ? (
              <div className="flex-1 min-h-0 flex gap-2 overflow-hidden">
                <div
                  className="flex-1 min-w-0 min-h-0 grid gap-2 overflow-hidden"
                  style={{
                    gridTemplateColumns:
                      syncColumns.length > 0
                        ? `repeat(${Math.min(syncColumns.length, MAX_SYNC_COLUMNS)}, minmax(0, 1fr))`
                        : '1fr',
                    ...(syncZoom !== 1 ? ({ zoom: syncZoom } as React.CSSProperties) : null),
                  }}
                >
                  {syncColumns.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/40 min-h-0 flex items-center justify-center px-3">
                      <span className="text-xs text-slate-500 text-center">
                        Select custom columns above — cards fill this row; dock timer stays on the right.
                      </span>
                    </div>
                  ) : (
                    syncColumns.map((col) => renderSyncColumnCard(col))
                  )}
                </div>
                {dockClockVisible ? (
                  <div className="flex-shrink-0 w-[12.5rem] min-h-0 rounded-lg border border-slate-600 bg-slate-950/90 px-2.5 py-2 text-right flex flex-col overflow-hidden">
                    <p className={`text-[10px] font-bold uppercase tracking-wide ${statusClass}`}>
                      {statusLabel}
                    </p>
                    <p
                      className="text-2xl font-mono font-bold tabular-nums leading-none mt-0.5"
                      style={{ color: timerColor }}
                    >
                      {timerDisplay}
                    </p>
                    <p
                      className="text-[11px] text-white font-semibold truncate mt-1.5"
                      title={liveCue?.segmentName || ''}
                    >
                      {liveCue?.segmentName || 'No cue loaded'}
                    </p>
                    <p className="text-[10px] text-slate-400 font-mono truncate">
                      {liveCue?.cue ? `CUE ${liveCue.cue}` : '—'}
                      {liveCue?.programType ? ` · ${liveCue.programType}` : ''}
                    </p>
                    {hasTimer ? (
                      <div className="mt-auto pt-1.5 w-full bg-slate-700 rounded-full overflow-hidden border border-slate-600 relative h-1.5">
                        <div
                          className="h-full transition-all duration-300 absolute top-0 right-0"
                          style={{ width: `${remainingPct}%`, background: timerColor }}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                className="flex-1 min-h-0 grid gap-2 overflow-hidden"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(syncColumns.length, MAX_SYNC_COLUMNS)}, minmax(0, 1fr))`,
                  ...(syncZoom !== 1 ? ({ zoom: syncZoom } as React.CSSProperties) : null),
                }}
              >
                {syncColumns.map((col) => renderSyncColumnCard(col))}
              </div>
            )}
          </section>
          </div>
        </div>
      )}

      <GuestSpeakersModal
        open={speakersItemId != null}
        item={guestSchedule.find((i) => i.id === speakersItemId) || null}
        panel={speakerPanel}
        onPanelChange={setSpeakerPanel}
        onClose={() => setSpeakersItemId(null)}
      />
    </div>
  );
};

export default DirectorViewPage;
