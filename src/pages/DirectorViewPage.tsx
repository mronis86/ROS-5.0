import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/database';
import { apiClient, getApiBaseUrl, type UserEventNoteOperator } from '../services/api-client';
import { socketClient } from '../services/socket-client';
import { apiJsonHeaders } from '../lib/sessionAuth';
import {
  getStoredOperatorName,
  operatorUserId,
  personColumnLabel,
} from '../lib/pinNotesOperator';
import { stripHtmlNotes, type GuestScheduleItem } from '../lib/eventGuestLinks';
import GuestRunOfShowGrid from '../components/guest/GuestRunOfShowGrid';
import GuestSpeakersModal from '../components/guest/GuestSpeakersModal';
import TeleprompterClockOverlay, {
  type TeleprompterClockComment,
  type TeleprompterClockFeed,
  type TeleprompterClockSettings,
  type TeleprompterVoiceHighlight,
} from '../components/TeleprompterClockOverlay';
import AppLogo from '../components/AppLogo';
import AppBrandTitle from '../components/AppBrandTitle';
import { GUEST_VISIBLE_COLUMNS, ROS_PROGRAM_TYPE_COLORS } from '../lib/guestRosHelpers';
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
import { findTopPreshowCue } from '../lib/preshowCountdown';
import { shouldUsePreshowRainbow } from '../lib/usePreshowRainbow';
import {
  enrichExternalSyncTimer,
  externalSyncStatusClass,
  formatExternalSyncStatusLine,
} from '../lib/externalSyncLabel';

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
const SYNC_STRIP_KEY = 'director-view-sync-strip';
const SYNC_CUE_VIEW_KEY = 'director-view-sync-cue-view';
const LEFT_PANE_MODE_KEY = 'director-view-left-pane';
const SCRIPT_VIEW_MODE_KEY = 'director-view-script-view';
const ROS_VIEW_MODE_KEY = 'director-view-ros-view';
/** Bottom Current/Next strip supports six custom columns inline (especially in Maximize). */
const MAX_SYNC_COLUMNS = 6;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 0.85;
const NOTES_ZOOM_DEFAULT = 1;
const SYNC_ZOOM_DEFAULT = 1;
const DEFAULT_SCRIPT_TELE_SETTINGS: TeleprompterClockSettings = {
  fontSize: 48,
  lineHeight: 1.4,
  textAlign: 'center',
  textColor: '#FFFFFF',
  backgroundColor: '#000000',
  showComments: true,
  readingGuideMode: 'arrows-with-lines',
  readingGuideColor: '#FF0000',
};
const SYNC_HEIGHT_MIN = 12;
const SYNC_HEIGHT_MAX = 48;
const SYNC_HEIGHT_DEFAULT = 24;

/** Normalize API / socket active-timer payloads to a single active row. */
function pickActiveTimer(raw: any): any | null {
  if (!raw) return null;
  let t: any = raw;
  if (Array.isArray(raw)) {
    t =
      raw.find((x: any) => x?.is_running && x?.is_active !== false) ||
      raw.find((x: any) => x?.is_active) ||
      raw[0] ||
      null;
  } else if (raw?.activeTimer) {
    t = raw.activeTimer;
  } else if (Array.isArray(raw?.timers)) {
    const list = raw.timers;
    t =
      list.find((x: any) => x?.is_running && x?.is_active !== false) ||
      list.find((x: any) => x?.is_active) ||
      list[0] ||
      null;
  } else if (Array.isArray(raw?.activeTimers)) {
    const list = raw.activeTimers;
    t =
      list.find((x: any) => x?.is_running && x?.is_active !== false) ||
      list.find((x: any) => x?.is_active) ||
      list[0] ||
      null;
  } else if (Array.isArray(raw?.value)) {
    const list = raw.value;
    t =
      list.find((x: any) => x?.is_running && x?.is_active !== false) ||
      list.find((x: any) => x?.is_active) ||
      list[0] ||
      null;
  }

  if (
    !t ||
    t.is_active === false ||
    t.cleared === true ||
    (t.item_id == null && t.itemId == null)
  ) {
    return null;
  }
  return t;
}

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
/** Left pane: personal notes (default) or event script / teleprompter follow. */
type LeftPaneMode = 'notes' | 'script';
type ScriptViewMode = 'plan' | 'follow';
/** Run of show pane: free scroll vs keep live cue centered. */
type RosViewMode = 'plan' | 'follow';
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
  /** Kept for AV / Mitti / Resolume LOADED·RUNNING feedback. */
  const [activeTimerMeta, setActiveTimerMeta] = useState<any | null>(null);
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
  /** Bottom synced custom-column strip (Current/Next cards). Off = notes + ROS only. */
  const [syncStripVisible, setSyncStripVisible] = useState(() => {
    try {
      const raw = localStorage.getItem(SYNC_STRIP_KEY);
      if (raw === null) return true;
      return raw !== 'false';
    } catch {
      return true;
    }
  });
  const [syncCueView, setSyncCueView] = useState<SyncCueView>(loadSyncCueView);
  const [leftPaneMode, setLeftPaneMode] = useState<LeftPaneMode>(() => {
    try {
      return localStorage.getItem(LEFT_PANE_MODE_KEY) === 'script' ? 'script' : 'notes';
    } catch {
      return 'notes';
    }
  });
  const [scriptViewMode, setScriptViewMode] = useState<ScriptViewMode>(() => {
    try {
      return localStorage.getItem(SCRIPT_VIEW_MODE_KEY) === 'follow' ? 'follow' : 'plan';
    } catch {
      return 'plan';
    }
  });
  const [rosViewMode, setRosViewMode] = useState<RosViewMode>(() => {
    try {
      return localStorage.getItem(ROS_VIEW_MODE_KEY) === 'follow' ? 'follow' : 'plan';
    } catch {
      return 'plan';
    }
  });
  const [scriptText, setScriptText] = useState('');
  const [scriptName, setScriptName] = useState('');
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptScrollPosition, setScriptScrollPosition] = useState(0);
  const [scriptGuideLinePosition, setScriptGuideLinePosition] = useState(50);
  const [scriptTeleSettings, setScriptTeleSettings] = useState<TeleprompterClockSettings>(
    DEFAULT_SCRIPT_TELE_SETTINGS
  );
  const [scriptComments, setScriptComments] = useState<TeleprompterClockComment[]>([]);
  const [scriptVoiceIgnoreLines, setScriptVoiceIgnoreLines] = useState<number[]>([]);
  const [scriptVoiceHighlight, setScriptVoiceHighlight] =
    useState<TeleprompterVoiceHighlight | null>(null);

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
      localStorage.setItem(SYNC_STRIP_KEY, syncStripVisible ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, [syncStripVisible]);

  useEffect(() => {
    try {
      localStorage.setItem(SYNC_CUE_VIEW_KEY, syncCueView);
    } catch {
      /* ignore */
    }
  }, [syncCueView]);

  useEffect(() => {
    try {
      localStorage.setItem(LEFT_PANE_MODE_KEY, leftPaneMode);
    } catch {
      /* ignore */
    }
  }, [leftPaneMode]);

  useEffect(() => {
    try {
      localStorage.setItem(SCRIPT_VIEW_MODE_KEY, scriptViewMode);
    } catch {
      /* ignore */
    }
  }, [scriptViewMode]);

  useEffect(() => {
    try {
      localStorage.setItem(ROS_VIEW_MODE_KEY, rosViewMode);
    } catch {
      /* ignore */
    }
  }, [rosViewMode]);

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
  const loadScript = useCallback(async () => {
    if (!eventId) return;
    setScriptLoading(true);
    try {
      // Prefer live active script for this event (socket catch-up)
      socketClient.emitScriptContentRequest();
      // Fallback: try fetching by eventId only if API still serves that shape
      const response = await fetch(`${getApiBaseUrl()}/api/scripts/${eventId}`, {
        headers: apiJsonHeaders(),
      });
      if (!response.ok) return;
      const data = await response.json();
      const text =
        typeof data.script_text === 'string'
          ? data.script_text
          : typeof data.script?.script_text === 'string'
            ? data.script.script_text
            : '';
      if (!text.trim()) return;
      setScriptText(text);
      setScriptName(
        typeof data.script_name === 'string'
          ? data.script_name
          : typeof data.script?.script_name === 'string'
            ? data.script.script_name
            : typeof data.name === 'string'
              ? data.name
              : ''
      );
    } catch {
      /* socket catch-up may still fill script */
    } finally {
      setScriptLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (leftPaneMode === 'script') {
      void loadScript();
      setSyncStripVisible(true);
      setShowSyncPicker(false);
    }
  }, [leftPaneMode, loadScript]);

  // Live script load/save from Scripts Follow → Director View
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    let attachedSock: ReturnType<typeof socketClient.getSocket> = null;

    const onScriptContent = (data: {
      eventId?: string;
      scriptText?: string;
      scriptName?: string;
      comments?: any[];
      voiceIgnoreLines?: number[];
    }) => {
      if (data.eventId && data.eventId !== eventId) return;
      if (typeof data.scriptText !== 'string') return;
      setScriptText(data.scriptText);
      if (typeof data.scriptName === 'string') setScriptName(data.scriptName);
      if (Array.isArray(data.comments)) {
        setScriptComments(
          data.comments.map((c: any) => ({
            id: String(c.id || `${c.lineNumber ?? c.line_number}-${c.text ?? c.comment_text}`),
            lineNumber: Number(c.lineNumber ?? c.line_number) || 0,
            text: String(c.text ?? c.comment_text ?? ''),
            type: String(c.type ?? c.comment_type ?? 'GENERAL'),
          }))
        );
      }
      if (Array.isArray(data.voiceIgnoreLines)) {
        setScriptVoiceIgnoreLines(
          data.voiceIgnoreLines
            .map((n: unknown) => Number(n))
            .filter((n: number) => Number.isInteger(n) && n >= 0)
        );
      }
      setScriptLoading(false);
    };

    const attach = () => {
      if (cancelled) return true;
      const sock = socketClient.getSocket();
      if (!sock) return false;
      if (attachedSock === sock) return true;
      if (attachedSock) attachedSock.off('scriptContentSync', onScriptContent);
      attachedSock = sock;
      sock.on('scriptContentSync', onScriptContent);
      socketClient.emitScriptContentRequest();
      return true;
    };

    attach();
    const poll = window.setInterval(() => {
      if (attach()) window.clearInterval(poll);
    }, 400);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      attachedSock?.off('scriptContentSync', onScriptContent);
    };
  }, [eventId]);

  // Teleprompter 16:9 feed: scroll, guides, settings (same canvas as Clock output)
  useEffect(() => {
    if (leftPaneMode !== 'script' || !eventId) return;
    let cancelled = false;
    let attachedSock: ReturnType<typeof socketClient.getSocket> = null;

    const applyVoiceHighlight = (raw: any) => {
      if (raw == null) {
        setScriptVoiceHighlight(null);
        return;
      }
      if (typeof raw !== 'object') return;
      setScriptVoiceHighlight({
        enabled: !!raw.enabled,
        wordIndex: typeof raw.wordIndex === 'number' ? raw.wordIndex : null,
        lineIndex: typeof raw.lineIndex === 'number' ? raw.lineIndex : null,
        style:
          raw.style === 'band' || raw.style === 'words' || raw.style === 'off'
            ? raw.style
            : 'words',
        color: typeof raw.color === 'string' && raw.color ? raw.color : '#FBBF24',
      });
    };

    const onScrollSync = (data: {
      scrollPosition?: number;
      fontSize?: number;
      eventId?: string;
      scriptText?: string;
      voiceHighlight?: TeleprompterVoiceHighlight | null;
      guideLinePosition?: number;
      settings?: Partial<TeleprompterClockSettings>;
    }) => {
      if (data.eventId && data.eventId !== eventId) return;
      if (typeof data.scriptText === 'string' && data.scriptText.trim()) {
        setScriptText(data.scriptText);
      }
      if (data.settings && typeof data.settings === 'object') {
        setScriptTeleSettings((prev) => ({ ...prev, ...data.settings }));
      } else if (typeof data.fontSize === 'number' && data.fontSize > 0) {
        setScriptTeleSettings((prev) =>
          prev.fontSize === data.fontSize ? prev : { ...prev, fontSize: data.fontSize! }
        );
      }
      if (typeof data.guideLinePosition === 'number') {
        setScriptGuideLinePosition(data.guideLinePosition);
      }
      if (typeof data.scrollPosition === 'number' && scriptViewMode === 'follow') {
        setScriptScrollPosition(Math.max(0, data.scrollPosition));
      }
      if ('voiceHighlight' in data) applyVoiceHighlight(data.voiceHighlight);
    };

    const onClockSync = (data: any) => {
      if (!data || data.enabled === false) return;
      if (data.eventId && data.eventId !== eventId) return;
      if (typeof data.scriptText === 'string' && data.scriptText.trim()) {
        setScriptText(data.scriptText);
      }
      if (typeof data.scriptName === 'string' && data.scriptName.trim()) {
        setScriptName(data.scriptName);
      }
      if (typeof data.scrollPosition === 'number' && scriptViewMode === 'follow') {
        setScriptScrollPosition(Math.max(0, data.scrollPosition));
      }
      if (typeof data.guideLinePosition === 'number') {
        setScriptGuideLinePosition(data.guideLinePosition);
      }
      if (data.settings && typeof data.settings === 'object') {
        setScriptTeleSettings((prev) => ({
          ...prev,
          ...data.settings,
        }));
      }
      if (Array.isArray(data.comments)) {
        setScriptComments(
          data.comments.map((c: any) => ({
            id: String(c.id),
            lineNumber: Number(c.lineNumber) || 0,
            text: String(c.text || ''),
            type: String(c.type || 'GENERAL'),
          }))
        );
      }
      if (Array.isArray(data.voiceIgnoreLines)) {
        setScriptVoiceIgnoreLines(
          data.voiceIgnoreLines
            .map((n: unknown) => Number(n))
            .filter((n: number) => Number.isInteger(n) && n >= 0)
        );
      }
      if ('voiceHighlight' in data) applyVoiceHighlight(data.voiceHighlight);
    };

    const onGuideLine = (data: { guideLinePosition?: number; eventId?: string }) => {
      if (data.eventId && data.eventId !== eventId) return;
      if (typeof data.guideLinePosition === 'number') {
        setScriptGuideLinePosition(data.guideLinePosition);
      }
    };

    const onSettings = (data: { settings?: Partial<TeleprompterClockSettings>; eventId?: string }) => {
      if (data.eventId && data.eventId !== eventId) return;
      if (data.settings && typeof data.settings === 'object') {
        setScriptTeleSettings((prev) => ({ ...prev, ...data.settings }));
      }
    };

    const attach = () => {
      if (cancelled) return true;
      const sock = socketClient.getSocket();
      if (!sock) return false;
      if (attachedSock === sock) return true;
      if (attachedSock) {
        attachedSock.off('scriptScrollSync', onScrollSync);
        attachedSock.off('teleprompterClockSync', onClockSync);
        attachedSock.off('teleprompterGuideLineUpdated', onGuideLine);
        attachedSock.off('teleprompterSettingsUpdated', onSettings);
      }
      attachedSock = sock;
      sock.on('scriptScrollSync', onScrollSync);
      sock.on('teleprompterClockSync', onClockSync);
      sock.on('teleprompterGuideLineUpdated', onGuideLine);
      sock.on('teleprompterSettingsUpdated', onSettings);
      return true;
    };

    attach();
    const poll = window.setInterval(() => {
      if (attach()) window.clearInterval(poll);
    }, 400);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      attachedSock?.off('scriptScrollSync', onScrollSync);
      attachedSock?.off('teleprompterClockSync', onClockSync);
      attachedSock?.off('teleprompterGuideLineUpdated', onGuideLine);
      attachedSock?.off('teleprompterSettingsUpdated', onSettings);
    };
  }, [leftPaneMode, scriptViewMode, eventId]);

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

  const clearTimerUi = useCallback(() => {
    setActiveItemId(null);
    setTimerRunning(false);
    setTimerLoaded(false);
    setTimerStartedAt(null);
    setTimerDurationSeconds(0);
    setTimerElapsedHint(0);
    setActiveTimerMeta(null);
  }, []);

  const applyTimer = useCallback(
    (timer: any) => {
      if (!timer) {
        clearTimerUi();
        return;
      }
      const enriched = enrichExternalSyncTimer(timer);
      setActiveTimerMeta(enriched);
      const rawId = enriched.item_id != null ? enriched.item_id : enriched.itemId;
      const id = rawId != null ? Number(rawId) : null;
      setActiveItemId(Number.isFinite(id as number) ? (id as number) : null);
      const running =
        enriched.timer_state === 'running' ||
        (!!(enriched.is_running && enriched.is_active !== false) &&
          enriched.timer_state !== 'loaded');
      const loaded =
        !running &&
        (enriched.timer_state === 'loaded' ||
          enriched.timer_state === 'armed' ||
          (!!enriched.is_active && !enriched.is_running));
      setTimerRunning(running);
      setTimerLoaded(loaded);
      const duration =
        Number(enriched.duration_seconds) ||
        Number(enriched.durationSeconds) ||
        0;
      setTimerDurationSeconds(Number.isFinite(duration) ? duration : 0);
      const started = enriched.started_at || enriched.startedAt || null;
      // Placeholder / non-running started_at values from API — ignore for countdown math
      const startedMs = started ? new Date(started).getTime() : NaN;
      const startedLooksReal =
        Number.isFinite(startedMs) &&
        startedMs > 0 &&
        startedMs < new Date('2090-01-01').getTime();
      setTimerStartedAt(running && startedLooksReal ? String(started) : null);
      const elapsedHint =
        typeof enriched.elapsed_seconds === 'number'
          ? enriched.elapsed_seconds
          : typeof enriched.elapsedSeconds === 'number'
            ? enriched.elapsedSeconds
            : 0;
      setTimerElapsedHint(Number.isFinite(elapsedHint) ? elapsedHint : 0);
    },
    [clearTimerUi]
  );

  const loadActiveTimer = useCallback(async () => {
    if (!eventId) return;
    try {
      // Prefer DatabaseService (no apiClient GET cache) so Director View boots with live state
      const timer = await DatabaseService.getActiveTimer(eventId);
      applyTimer(timer ? pickActiveTimer(timer) || timer : null);
    } catch {
      try {
        const data = await apiClient.getActiveTimers(eventId);
        applyTimer(pickActiveTimer(data));
      } catch {
        /* keep last known UI; socket may still update */
      }
    }
  }, [eventId, applyTimer]);

  // Live timer sync — fetch current state on connect; keep listening for updates
  useEffect(() => {
    if (!eventId) return;
    void loadActiveTimer();

    socketClient.connect(
      eventId,
      {
        onInitialSync: async () => {
          await loadActiveTimer();
        },
        onTimerUpdated: (data: any) => {
          applyTimer(pickActiveTimer(data) || (data?.item_id != null || data?.itemId != null ? data : null));
        },
        onTimerStarted: (data: any) => {
          const t = pickActiveTimer(data) || data;
          if (t) applyTimer({ ...t, is_running: true, is_active: true, timer_state: 'running' });
        },
        onTimerStopped: () => {
          setTimerRunning(false);
          setTimerLoaded(false);
          setTimerStartedAt(null);
          void loadActiveTimer();
        },
        onTimersStopped: () => clearTimerUi(),
        onActiveTimersUpdated: (data: any) => {
          applyTimer(pickActiveTimer(data));
        },
        onResetAllStates: () => clearTimerUi(),
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
  }, [eventId, loadSchedule, loadActiveTimer, applyTimer, clearTimerUi]);

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
  const statusLabel = formatExternalSyncStatusLine({
    running: timerRunning,
    loaded: timerLoaded,
    timer: activeTimerMeta,
    includeCue: false,
    idleLabel: 'STANDBY',
  });
  const statusClass = externalSyncStatusClass({
    running: timerRunning,
    loaded: timerLoaded,
    timer: activeTimerMeta,
    idleClass: 'text-slate-400',
  });
  const activeFilterCount =
    GUEST_COLUMN_TOGGLE_OPTIONS.filter((opt) => !visibleColumns[opt.key]).length +
    customColumns.filter((col) => visibleCustomColumns[col.id] === false).length;

  const liveCue =
    activeItemId != null
      ? guestSchedule.find((i) => i.id === activeItemId) || null
      : null;

  const topPreshowItemId = useMemo(
    () =>
      findTopPreshowCue(guestSchedule, indentedLookup, liveCue?.day ?? selectedDay)?.id ?? null,
    [guestSchedule, indentedLookup, liveCue?.day, selectedDay]
  );

  const usePreshowRainbow = shouldUsePreshowRainbow(null, {
    isRunning: timerRunning,
    programType: liveCue?.programType,
    itemId: activeItemId,
    topPreshowItemId,
  });

  const liveSegmentLabel = String(liveCue?.segmentName || '')
    .replace(/^\s*[|│¦∥∣↳↘›>]\s*/u, '')
    .trim();

  /** CUE # + Program Type badge — shown above the session/segment title. */
  const renderLiveCueMeta = (opts?: {
    align?: 'left' | 'right' | 'center';
    compact?: boolean;
    emphasize?: boolean;
  }) => {
    const align = opts?.align ?? 'left';
    const compact = !!opts?.compact;
    const emphasize = !!opts?.emphasize;
    const cueText = liveCue?.cue ? String(liveCue.cue).trim() : '';
    const programType = liveCue?.programType ? String(liveCue.programType).trim() : '';
    const badgeColor = programType ? ROS_PROGRAM_TYPE_COLORS[programType] || '#64748B' : '#64748B';
    const hex = badgeColor.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const badgeText =
      Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && (r * 299 + g * 587 + b * 114) / 1000 > 160
        ? '#0f172a'
        : '#ffffff';
    const title = `CUE ${cueText || '—'} : ${programType || '—'}`;
    // Dock emphasize: slightly above segment title, not oversized
    const cuePad = emphasize
      ? 'px-1.5 py-0.5 text-[11px] leading-none'
      : compact
        ? 'px-1.5 py-0.5 text-[10px] leading-none'
        : 'px-2 py-0.5 text-xs leading-none';
    const typePad = emphasize
      ? 'px-1.5 py-0.5 text-[11px] leading-none'
      : compact
        ? 'px-1.5 py-0.5 text-[10px] leading-none'
        : 'px-2 py-0.5 text-xs leading-none';
    return (
      <div
        className={`flex flex-nowrap items-center gap-1 min-w-0 ${
          align === 'right'
            ? 'justify-end'
            : align === 'center'
              ? 'justify-center'
              : 'justify-start'
        }`}
        title={title}
      >
        <span
          className={`inline-flex shrink-0 items-baseline gap-1 rounded border border-slate-600 bg-slate-800/90 font-sans text-slate-200 ${cuePad}`}
        >
          <span className="font-semibold tracking-wide text-slate-400">CUE</span>
          <span className="font-mono font-bold tabular-nums text-white">{cueText || '—'}</span>
        </span>
        <span className={`shrink-0 leading-none text-slate-500 ${emphasize || !compact ? 'text-[11px]' : 'text-[10px]'}`}>
          :
        </span>
        {programType ? (
          <span
            className={`inline-flex min-w-0 truncate rounded-md border border-white/15 font-sans font-semibold shadow-sm ${typePad}`}
            style={{ backgroundColor: badgeColor, color: badgeText }}
            title={programType}
          >
            {programType}
          </span>
        ) : (
          <span
            className={`inline-flex shrink-0 rounded-md border border-slate-600 bg-slate-800 text-slate-400 ${typePad}`}
          >
            —
          </span>
        )}
      </div>
    );
  };

  /** Maximize dock: right-justified; larger timer; cue/type badges above segment title. */
  const renderDockClockCard = () => (
    <div className="flex-shrink-0 w-[16.5rem] min-h-0 rounded-lg border border-slate-600 bg-slate-950/90 px-2.5 py-2 text-right flex flex-col overflow-hidden">
      <p className={`text-[10px] font-bold uppercase tracking-wide leading-none ${statusClass}`}>
        {statusLabel}
      </p>
      {usePreshowRainbow ? (
        <div className="mt-1.5">
          <div className="ros-preshow-super text-[10px] leading-none tracking-wide">
            PRE SHOW COUNTDOWN
          </div>
          <span className="ros-preshow-super-rule" aria-hidden />
          <p className="w-full text-right text-[3.85rem] font-mono font-black tabular-nums leading-[0.95] mt-1 tracking-tighter ros-rainbow-text">
            {timerDisplay}
          </p>
        </div>
      ) : (
        <p
          className="w-full text-right text-[3.85rem] font-mono font-black tabular-nums leading-[0.95] mt-1.5 tracking-tighter"
          style={{ color: timerColor }}
        >
          {timerDisplay}
        </p>
      )}
      <div className="mt-2.5 space-y-1 min-w-0">
        {renderLiveCueMeta({ align: 'right', emphasize: true })}
        <p
          className="text-[11px] text-slate-400 font-medium truncate leading-tight"
          title={liveSegmentLabel || ''}
        >
          {liveSegmentLabel || 'No cue loaded'}
        </p>
      </div>
    </div>
  );

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

  const notesBody = (
    <>
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
    </>
  );

  const notesChrome = (
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
  );

  const scriptTeleFeed: TeleprompterClockFeed = {
    enabled: true,
    scriptText,
    scrollPosition: scriptScrollPosition,
    settings: scriptTeleSettings,
    guideLinePosition: scriptGuideLinePosition,
    comments: scriptComments,
    voiceIgnoreLines: scriptVoiceIgnoreLines,
    scriptName: scriptName || undefined,
    voiceHighlight: scriptVoiceHighlight,
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
                onClick={() => {
                  setLeftPaneMode((m) => (m === 'script' ? 'notes' : 'script'));
                }}
                className={`px-2.5 py-1 text-sm rounded border whitespace-nowrap ${
                  leftPaneMode === 'script'
                    ? 'border-violet-500/70 bg-violet-950/50 text-violet-100 hover:bg-violet-900/50'
                    : 'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                title="Script mode: event script on the left (Scroll/Follow teleprompter), personal notes in the bottom strip"
              >
                Script {leftPaneMode === 'script' ? 'on' : 'off'}
              </button>
              {leftPaneMode === 'notes' ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowSyncPicker((v) => {
                      const next = !v;
                      if (next) setSyncStripVisible(true);
                      return next;
                    });
                  }}
                  className="px-2.5 py-1 text-sm rounded border border-slate-600 bg-slate-800 hover:bg-slate-700 whitespace-nowrap"
                >
                  Sync ({syncColumnIds.length}/{MAX_SYNC_COLUMNS})
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setSyncStripVisible((v) => !v)}
                className={`px-2.5 py-1 text-sm rounded border whitespace-nowrap ${
                  syncStripVisible
                    ? 'border-amber-600/70 bg-amber-950/40 text-amber-100 hover:bg-amber-900/50'
                    : 'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                title={
                  leftPaneMode === 'script'
                    ? syncStripVisible
                      ? 'Hide bottom notes strip'
                      : 'Show bottom notes strip'
                    : syncStripVisible
                      ? 'Hide bottom custom-column strip — notes + Run of Show only'
                      : 'Show bottom custom-column strip'
                }
              >
                {leftPaneMode === 'script'
                  ? syncStripVisible
                    ? 'Hide notes'
                    : 'Show notes'
                  : syncStripVisible
                    ? 'Hide custom'
                    : 'Show custom'}
              </button>
              <button
                type="button"
                onClick={() => {
                  void loadSchedule();
                  void loadNotes();
                  void loadActiveTimer();
                  if (leftPaneMode === 'script') void loadScript();
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
                {renderLiveCueMeta({ align: 'left' })}
                <p className="text-base font-semibold text-white truncate mt-1">
                  {liveSegmentLabel || 'No cue loaded'}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-bold ${statusClass}`}>{statusLabel}</p>
                {usePreshowRainbow ? (
                  <div className="mt-0.5">
                    <div className="ros-preshow-super text-[11px] leading-none">PRE SHOW COUNTDOWN</div>
                    <span className="ros-preshow-super-rule" aria-hidden />
                    <p className="text-4xl font-mono font-bold tabular-nums leading-none mt-1 ros-rainbow-text">
                      {timerDisplay}
                    </p>
                  </div>
                ) : (
                  <p
                    className="text-4xl font-mono font-bold tabular-nums leading-none mt-0.5"
                    style={{ color: timerColor }}
                  >
                    {timerDisplay}
                  </p>
                )}
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {timerRunning ? 'Remaining' : timerLoaded ? 'Loaded' : 'Standby'}
                </p>
              </div>
            </div>
            {hasTimer ? (
              <div className="mt-2 w-full bg-slate-700 rounded-full overflow-hidden border border-slate-600 relative h-2">
                <div
                  className={`h-full transition-all duration-300 absolute top-0 right-0 ${
                    usePreshowRainbow ? 'ros-rainbow-fill' : ''
                  }`}
                  style={{
                    width: `${remainingPct}%`,
                    ...(usePreshowRainbow ? {} : { background: timerColor }),
                  }}
                />
              </div>
            ) : null}
          </div>

          {showSyncPicker && leftPaneMode === 'notes' ? (
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
                  onClick={() => {
                    setLeftPaneMode((m) => (m === 'script' ? 'notes' : 'script'));
                  }}
                  className={`px-2.5 py-1 text-xs font-semibold rounded border whitespace-nowrap ${
                    leftPaneMode === 'script'
                      ? 'border-violet-500/70 bg-violet-950/50 text-violet-100'
                      : 'border-slate-600 bg-slate-800 text-slate-300'
                  }`}
                  title="Script on left; notes in bottom strip"
                >
                  Script {leftPaneMode === 'script' ? 'on' : 'off'}
                </button>
                <button
                  type="button"
                  onClick={() => setSyncStripVisible((v) => !v)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded border whitespace-nowrap ${
                    syncStripVisible
                      ? 'border-amber-600/70 bg-amber-950/40 text-amber-100'
                      : 'border-slate-600 bg-slate-800 text-slate-300'
                  }`}
                  title={
                    leftPaneMode === 'script'
                      ? syncStripVisible
                        ? 'Hide bottom notes strip'
                        : 'Show bottom notes strip'
                      : syncStripVisible
                        ? 'Hide bottom custom-column strip'
                        : 'Show bottom custom-column strip'
                  }
                >
                  {leftPaneMode === 'script'
                    ? syncStripVisible
                      ? 'Hide notes'
                      : 'Show notes'
                    : syncStripVisible
                      ? 'Hide custom'
                      : 'Show custom'}
                </button>
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
                    void loadActiveTimer();
                    if (leftPaneMode === 'script') void loadScript();
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
              {leftPaneMode === 'script' ? (
                <>
                  <div className="flex-shrink-0 px-3 py-1.5 border-b border-slate-700 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-violet-300">Script · 16:9</h2>
                      <p className="text-[10px] text-slate-500 truncate">
                        {scriptName || 'Same canvas as teleprompter / clock output'}
                        {scriptTeleSettings.readingGuideMode &&
                        scriptTeleSettings.readingGuideMode !== 'off'
                          ? ' · guides on'
                          : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <div className="flex rounded-lg bg-slate-800 p-0.5 border border-slate-600">
                        <button
                          type="button"
                          onClick={() => setScriptViewMode('plan')}
                          className={`px-2.5 py-1 text-[11px] font-semibold rounded-md ${
                            scriptViewMode === 'plan'
                              ? 'bg-cyan-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                          title="Free-scroll inside the 16:9 frame"
                        >
                          Scroll
                        </button>
                        <button
                          type="button"
                          onClick={() => setScriptViewMode('follow')}
                          className={`px-2.5 py-1 text-[11px] font-semibold rounded-md ${
                            scriptViewMode === 'follow'
                              ? 'bg-purple-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                          title="Lock scroll, reading guide, and speaker highlight to the teleprompter scroller"
                        >
                          Follow
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden bg-black">
                    {scriptLoading && !scriptText ? (
                      <p className="text-sm text-slate-500 p-3">Loading script…</p>
                    ) : !scriptText.trim() ? (
                      <p className="text-sm text-slate-500 p-3">
                        No script for this event. Load one in Scripts Follow / Teleprompter first.
                      </p>
                    ) : (
                      <TeleprompterClockOverlay
                        feed={scriptTeleFeed}
                        followScroll={scriptViewMode === 'follow'}
                        className="h-full w-full"
                      />
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex-shrink-0 px-3 py-1.5 border-b border-slate-700 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-sky-300">Personal notes</h2>
                    {notesChrome}
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
                    {notesBody}
                  </div>
                </>
              )}
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
                  <div className="flex rounded-lg bg-slate-800 p-0.5 border border-slate-600">
                    <button
                      type="button"
                      onClick={() => setRosViewMode('plan')}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md ${
                        rosViewMode === 'plan'
                          ? 'bg-cyan-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Free-scroll the run of show"
                    >
                      Scroll
                    </button>
                    <button
                      type="button"
                      onClick={() => setRosViewMode('follow')}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md ${
                        rosViewMode === 'follow'
                          ? 'bg-purple-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Keep the live cue centered as the show advances"
                    >
                      Follow
                    </button>
                  </div>
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
                  followActive={rosViewMode === 'follow'}
                  onOpenSpeakers={(id) => setSpeakersItemId(id)}
                />
              </div>
            </main>
          </div>

          {syncStripVisible ? (
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
          ) : null}

          {/* Bottom strip — height from drag handle above (hidden via Hide custom) */}
          {syncStripVisible ? (
          <section
            className="min-h-0 flex flex-col overflow-hidden border-t border-slate-700 bg-slate-900/95 px-3 py-2"
            style={{ flex: `0 0 ${syncHeightPct}%`, height: `${syncHeightPct}%` }}
          >
            {leftPaneMode === 'script' ? (
              <>
                <div className="flex-shrink-0 flex items-center justify-between gap-2 mb-1.5 min-w-0 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <h2 className="text-sm font-semibold text-sky-300 whitespace-nowrap">
                      Personal notes
                    </h2>
                    <span className="text-[10px] tabular-nums text-slate-500">
                      {syncHeightPct}% tall
                    </span>
                    {notesChrome}
                  </div>
                </div>
                <div className="flex-1 min-h-0 flex gap-2 overflow-hidden">
                  <div
                    ref={notesListRef}
                    className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden p-1 space-y-2"
                    style={
                      notesZoom !== 1
                        ? ({ zoom: notesZoom } as React.CSSProperties)
                        : undefined
                    }
                  >
                    <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {notesBody}
                    </div>
                  </div>
                  {dockClockVisible ? renderDockClockCard() : null}
                </div>
              </>
            ) : (
              <>
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
                {dockClockVisible ? renderDockClockCard() : null}
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
              </>
            )}
          </section>
          ) : !chromeExpanded && dockClockVisible ? (
            <div className="flex-shrink-0 border-t border-slate-700 bg-slate-900/95 px-3 py-2.5 flex items-center justify-end">
              {renderDockClockCard()}
            </div>
          ) : null}
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
