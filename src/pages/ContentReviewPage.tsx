import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Event } from '../types/Event';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';

type ContentReviewFollowMode = 'solo' | 'drive' | 'follow';
type ReviewStatus = 'pending' | 'needs_update' | 'approved';

interface CueReviewEntry {
  status: ReviewStatus;
  note: string;
  updatedAt: string;
  updatedBy: string;
}

type CueReviewMap = Record<number, CueReviewEntry>;
type StreamFloatRect = { left: number; top: number; width: number; height: number };

function reviewStatusMeta(status: ReviewStatus) {
  switch (status) {
    case 'approved':
      return {
        label: 'Approved',
        railClass: 'bg-emerald-900/60 text-emerald-200 border-emerald-700/70',
        cardClass: 'border-emerald-700/70 bg-emerald-950/25 text-emerald-100'
      };
    case 'needs_update':
      return {
        label: 'Needs update',
        railClass: 'bg-amber-900/60 text-amber-200 border-amber-700/70',
        cardClass: 'border-amber-700/70 bg-amber-950/25 text-amber-100'
      };
    default:
      return {
        label: 'Pending',
        railClass: 'bg-slate-800 text-slate-300 border-slate-600/70',
        cardClass: 'border-slate-600/70 bg-slate-800/70 text-slate-200'
      };
  }
}

/** Matches PhotoView / print cue styling */
const PROGRAM_TYPE_COLORS: Record<string, string> = {
  'Podium Transition': '#8B4513',
  'Panel Transition': '#404040',
  'Sub Cue': '#F3F4F6',
  'No Transition': '#059669',
  Video: '#F59E0B',
  'Panel+Remote': '#1E40AF',
  'Remote Only': '#60A5FA',
  'Break F&B/B2B': '#EC4899',
  'Breakout Session': '#20B2AA',
  TBD: '#6B7280',
  KILLED: '#DC2626',
  Podium: '#8B4513',
  Panel: '#404040',
  'PreShow/End': '#8B5CF6'
};

interface CustomColumn {
  name: string;
  id: string;
}

interface ScheduleItem {
  id: number;
  day: number;
  programType: string;
  shotType: string;
  segmentName: string;
  durationHours: number;
  durationMinutes: number;
  durationSeconds: number;
  notes: string;
  assets: string;
  speakersText: string;
  hasPPT?: boolean;
  hasQA?: boolean;
  customFields: Record<string, string>;
  isStartCue?: boolean;
}

type IndentedMap = Record<number, { parentId: number; userName?: string }>;

function normalizeScheduleItem(raw: any): ScheduleItem {
  const sec = raw.duration_seconds ?? raw.durationSeconds ?? 0;
  const cf = raw.customFields ?? raw.custom_fields ?? {};
  return {
    id: Number(raw.id),
    day: Number(raw.day ?? 1),
    programType: String(raw.programType ?? raw.program_type ?? ''),
    shotType: String(raw.shotType ?? raw.shot_type ?? ''),
    segmentName: String(raw.segmentName ?? raw.segment_name ?? ''),
    durationHours: Math.floor(sec / 3600),
    durationMinutes: Math.floor((sec % 3600) / 60),
    durationSeconds: sec % 60,
    notes: String(raw.notes ?? ''),
    assets: String(raw.assets ?? ''),
    speakersText: String(raw.speakersText ?? raw.speakers_text ?? ''),
    hasPPT: !!(raw.hasPPT ?? raw.has_ppt),
    hasQA: !!(raw.hasQA ?? raw.has_qa),
    customFields: typeof cf === 'object' && cf !== null ? cf : {},
    isStartCue: !!(raw.isStartCue ?? raw.is_start_cue)
  };
}

function formatCueDisplay(cue: string | undefined): string {
  if (!cue) return 'CUE';
  if (cue.includes('CUE ')) return cue;
  return cue.replace(/^CUE(\d+)$/, 'CUE $1');
}

function formatDurationClock(it: ScheduleItem): string {
  const { durationHours: h, durationMinutes: m, durationSeconds: s } = it;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatDurationShort(it: ScheduleItem): string {
  const { durationHours: h, durationMinutes: m, durationSeconds: s } = it;
  if (h === 0 && m === 0 && s === 0) return '—';
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Walk up parent links until this id is a top-level (non-indented) row. */
function rootIdFor(itemId: number, indented: IndentedMap): number {
  let cur = itemId;
  const seen = new Set<number>();
  while (indented[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = indented[cur].parentId;
    if (seen.size > 40) break;
  }
  return cur;
}

/** Only http(s) embed targets — blocks javascript:, data:, etc. */
function sanitizeStreamEmbedUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function streamUrlFromSearchParam(raw: string | null): string | null {
  if (!raw) return null;
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  return sanitizeStreamEmbedUrl(decoded);
}

function depthFor(itemId: number, indented: IndentedMap): number {
  let d = 0;
  let cur = itemId;
  const seen = new Set<number>();
  while (indented[cur] && !seen.has(cur)) {
    seen.add(cur);
    d++;
    cur = indented[cur].parentId;
    if (d > 40) break;
  }
  return d;
}

function buildIndentedMap(data: any[] | null): IndentedMap {
  const map: IndentedMap = {};
  if (!data || !Array.isArray(data)) return map;
  for (const row of data) {
    const itemId = row.item_id ?? row.itemId;
    const parentId = row.parent_item_id ?? row.parentItemId;
    if (itemId != null && parentId != null) {
      map[Number(itemId)] = {
        parentId: Number(parentId),
        userName: row.user_name ?? row.userName
      };
    }
  }
  return map;
}

/** Seven speaker slots like PhotoView print row */
function parseSpeakersSlots(speakersTextJson: string): string[] {
  const out = Array(7).fill('');
  if (!speakersTextJson) return out;
  try {
    const arr = JSON.parse(speakersTextJson);
    if (!Array.isArray(arr)) return out;
    for (const s of arr) {
      const slot = Number(s.slot);
      if (!Number.isFinite(slot) || slot < 1 || slot > 7) continue;
      const loc =
        s.location === 'Podium'
          ? 'P'
          : s.location === 'Seat'
            ? 'S'
            : s.location === 'Virtual'
              ? 'V'
              : 'M';
      const name = (s.fullName || '').trim() || '—';
      out[slot - 1] = `${loc}${slot}\n${name}`;
    }
  } catch {
    /* ignore */
  }
  return out;
}

const ContentReviewPage: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlParams = new URLSearchParams(location.search);
  const eventIdParam = urlParams.get('eventId');
  const eventNameParam = urlParams.get('eventName');

  const [event, setEvent] = useState<Event>(() => {
    const fromState = location.state?.event as Event | undefined;
    if (fromState?.id) return fromState;
    return {
      id: eventIdParam || '',
      name: eventNameParam || 'Event',
      date: '',
      location: '',
      numberOfDays: 1
    };
  });

  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([]);
  const [indented, setIndented] = useState<IndentedMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const cueButtonRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());

  const eventId = event?.id || eventIdParam || '';

  const streamFromQuery = useMemo(
    () => streamUrlFromSearchParam(searchParams.get('streamUrl')),
    [searchParams]
  );
  const streamStorageKey = eventId ? `ros.contentReview.streamUrl.${eventId}` : null;
  const sideRailStorageKey = eventId ? `ros.contentReview.sideRailWidth.${eventId}` : null;
  const [savedStreamUrl, setSavedStreamUrl] = useState<string | null>(null);
  const [streamPanelOpen, setStreamPanelOpen] = useState(false);
  const [streamFloatOpen, setStreamFloatOpen] = useState(false);
  const [streamFloatRect, setStreamFloatRect] = useState<StreamFloatRect>({
    left: 0,
    top: 0,
    width: 920,
    height: 560
  });
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  /** Width of review+stream column on large screens (px). */
  const [sideRailWidthPx, setSideRailWidthPx] = useState(416);
  const [isLgLayout, setIsLgLayout] = useState(false);
  const [sideRailResizing, setSideRailResizing] = useState(false);
  const [streamUrlDraft, setStreamUrlDraft] = useState('');
  const [streamSetupOpen, setStreamSetupOpen] = useState(false);
  const [cueReviews, setCueReviews] = useState<CueReviewMap>({});

  const [followMode, setFollowMode] = useState<ContentReviewFollowMode>('solo');
  const [followSourceName, setFollowSourceName] = useState('');
  const followModeRef = useRef<ContentReviewFollowMode>('solo');
  const scheduleRef = useRef<ScheduleItem[]>([]);
  const applyRemoteSelectionRef = useRef(false);
  const scheduleLenRef = useRef(0);

  const driverId = user?.id ?? 'guest';
  const driverName = (user?.full_name || user?.email || 'Guest').trim() || 'Guest';
  const reviewStorageKey = eventId ? `ros.contentReview.cueReview.${eventId}` : null;
  const streamDragRef = useRef<{ active: boolean; offsetX: number; offsetY: number }>({
    active: false,
    offsetX: 0,
    offsetY: 0
  });
  const streamResizeRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0
  });
  /** `active` while dragging the main | review split; `lastW` for persistence. */
  const sideRailDragRef = useRef<{ active: boolean; lastW: number }>({ active: false, lastW: 416 });
  const sideRailResizeRowRef = useRef<HTMLDivElement>(null);

  const clampSideRailWidth = useCallback((w: number) => {
    if (typeof window === 'undefined') return w;
    const minW = 260;
    const maxW = Math.min(680, Math.floor(window.innerWidth * 0.58));
    return Math.min(Math.max(w, minW), Math.max(minW, maxW));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsLgLayout(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!sideRailStorageKey || typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(sideRailStorageKey);
      if (!raw) return;
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n)) return;
      setSideRailWidthPx(clampSideRailWidth(n));
    } catch {
      /* ignore */
    }
  }, [sideRailStorageKey, clampSideRailWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setSideRailWidthPx((w) => clampSideRailWidth(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampSideRailWidth]);

  const clampStreamRect = useCallback((next: StreamFloatRect): StreamFloatRect => {
    if (typeof window === 'undefined') return next;
    const margin = 8;
    const minW = 360;
    const minH = 220;
    const maxW = Math.max(minW, window.innerWidth - margin * 2);
    const maxH = Math.max(minH, window.innerHeight - margin * 2);
    const width = Math.min(Math.max(next.width, minW), maxW);
    const height = Math.min(Math.max(next.height, minH), maxH);
    const left = Math.min(Math.max(next.left, margin), window.innerWidth - width - margin);
    const top = Math.min(Math.max(next.top, margin), window.innerHeight - height - margin);
    return { left, top, width, height };
  }, []);

  useEffect(() => {
    if (!reviewStorageKey || typeof localStorage === 'undefined') {
      setCueReviews({});
      return;
    }
    try {
      const raw = localStorage.getItem(reviewStorageKey);
      if (!raw) {
        setCueReviews({});
        return;
      }
      const parsed = JSON.parse(raw) as CueReviewMap;
      setCueReviews(parsed && typeof parsed === 'object' ? parsed : {});
    } catch {
      setCueReviews({});
    }
  }, [reviewStorageKey]);

  useEffect(() => {
    if (!reviewStorageKey || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(reviewStorageKey, JSON.stringify(cueReviews));
    } catch {
      /* ignore quota */
    }
  }, [reviewStorageKey, cueReviews]);

  useEffect(() => {
    followModeRef.current = followMode;
  }, [followMode]);

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  useEffect(() => {
    if (followMode !== 'follow') setFollowSourceName('');
  }, [followMode]);

  useEffect(() => {
    if (!eventId) return;
    socketClient.connect(eventId, {});
    const socket = socketClient.getSocket();
    const onConnect = () => {
      if (followModeRef.current === 'follow') socketClient.emitContentReviewRequestState();
    };
    const onSync = (payload: {
      eventId?: string;
      itemId?: number;
      fromUserName?: string;
    }) => {
      if (!payload || String(payload.eventId) !== String(eventId)) return;
      if (followModeRef.current !== 'follow') return;
      const id = Number(payload.itemId);
      if (!Number.isFinite(id)) return;
      const rows = scheduleRef.current;
      if (!rows.some((r) => r.id === id)) return;
      const name = (payload.fromUserName || '').trim();
      if (name) setFollowSourceName(name);
      applyRemoteSelectionRef.current = true;
      setSelectedId(id);
      queueMicrotask(() => {
        applyRemoteSelectionRef.current = false;
      });
    };
    socket?.on('connect', onConnect);
    socket?.on('contentReviewSelectionSync', onSync);
    if (socket?.connected && followModeRef.current === 'follow') {
      socketClient.emitContentReviewRequestState();
    }
    return () => {
      socket?.off('connect', onConnect);
      socket?.off('contentReviewSelectionSync', onSync);
    };
  }, [eventId]);

  useEffect(() => {
    if (followMode !== 'follow' || !eventId) return;
    if (socketClient.isConnected()) socketClient.emitContentReviewRequestState();
  }, [followMode, eventId]);

  useEffect(() => {
    scheduleLenRef.current = 0;
  }, [eventId]);

  /** If Follow was on before rows loaded, catch up once the schedule exists. */
  useEffect(() => {
    const prev = scheduleLenRef.current;
    const len = schedule.length;
    if (followMode === 'follow' && eventId && prev === 0 && len > 0 && socketClient.isConnected()) {
      socketClient.emitContentReviewRequestState();
    }
    scheduleLenRef.current = len;
  }, [schedule.length, followMode, eventId]);

  useEffect(() => {
    if (!eventId || followMode !== 'drive' || selectedId == null) return;
    if (applyRemoteSelectionRef.current) return;
    socketClient.emitContentReviewSelectionUpdate(selectedId, driverId, driverName);
  }, [eventId, followMode, selectedId, driverId, driverName]);

  useEffect(() => {
    if (streamFromQuery) {
      setSavedStreamUrl(streamFromQuery);
      return;
    }
    if (!streamStorageKey || typeof localStorage === 'undefined') {
      setSavedStreamUrl(null);
      return;
    }
    try {
      const stored = localStorage.getItem(streamStorageKey);
      setSavedStreamUrl(stored ? sanitizeStreamEmbedUrl(stored) : null);
    } catch {
      setSavedStreamUrl(null);
    }
  }, [streamFromQuery, streamStorageKey]);

  useEffect(() => {
    if (streamFromQuery) setStreamPanelOpen(true);
  }, [streamFromQuery]);

  const applyStreamUrl = useCallback(() => {
    const next = sanitizeStreamEmbedUrl(streamUrlDraft);
    if (!next) return;
    setSavedStreamUrl(next);
    if (streamStorageKey) {
      try {
        localStorage.setItem(streamStorageKey, next);
      } catch {
        /* ignore quota */
      }
    }
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('streamUrl', next);
        return p;
      },
      { replace: true }
    );
    setStreamUrlDraft(next);
    setStreamSetupOpen(false);
  }, [streamUrlDraft, streamStorageKey, setSearchParams]);

  const clearStreamUrl = useCallback(() => {
    setSavedStreamUrl(null);
    setStreamUrlDraft('');
    if (streamStorageKey) {
      try {
        localStorage.removeItem(streamStorageKey);
      } catch {
        /* ignore */
      }
    }
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('streamUrl');
        return p;
      },
      { replace: true }
    );
    setStreamSetupOpen(true);
  }, [streamStorageKey, setSearchParams]);

  useEffect(() => {
    if (!savedStreamUrl) setStreamFloatOpen(false);
  }, [savedStreamUrl]);

  useEffect(() => {
    if (!streamFloatOpen || typeof window === 'undefined') return;
    setStreamFloatRect((prev) => {
      const next = prev.left === 0 && prev.top === 0 ? { left: window.innerWidth - 960, top: window.innerHeight - 600, width: 920, height: 560 } : prev;
      return clampStreamRect(next);
    });
  }, [streamFloatOpen, clampStreamRect]);

  useEffect(() => {
    if (!streamFloatOpen || typeof window === 'undefined') return;
    const onResize = () => setStreamFloatRect((prev) => clampStreamRect(prev));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [streamFloatOpen, clampStreamRect]);

  useEffect(() => {
    if (!streamFloatOpen || typeof window === 'undefined') return;
    const onMove = (e: PointerEvent) => {
      if (streamDragRef.current.active) {
        const nextLeft = e.clientX - streamDragRef.current.offsetX;
        const nextTop = e.clientY - streamDragRef.current.offsetY;
        setStreamFloatRect((prev) => clampStreamRect({ ...prev, left: nextLeft, top: nextTop }));
        return;
      }
      if (streamResizeRef.current.active) {
        const dx = e.clientX - streamResizeRef.current.startX;
        const dy = e.clientY - streamResizeRef.current.startY;
        setStreamFloatRect((prev) =>
          clampStreamRect({
            ...prev,
            width: streamResizeRef.current.startWidth + dx,
            height: streamResizeRef.current.startHeight + dy
          })
        );
      }
    };
    const onUp = () => {
      streamDragRef.current.active = false;
      streamResizeRef.current.active = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [streamFloatOpen, clampStreamRect]);

  useEffect(() => {
    if (!sideRailResizing) return;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [sideRailResizing]);

  const startDragStreamFloat = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    streamDragRef.current = {
      active: true,
      offsetX: e.clientX - streamFloatRect.left,
      offsetY: e.clientY - streamFloatRect.top
    };
  }, [streamFloatRect.left, streamFloatRect.top]);

  const startResizeStreamFloat = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    streamResizeRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: streamFloatRect.width,
      startHeight: streamFloatRect.height
    };
  }, [streamFloatRect.height, streamFloatRect.width]);

  /** Match `w-3` grip; width = review/stream column only (not the grip). */
  const SIDE_RAIL_GRIP_PX = 12;
  const SIDE_RAIL_MIN_MAIN_PX = 260;

  const updateSideRailWidthFromPointer = useCallback(
    (e: { clientX: number }) => {
      const row = sideRailResizeRowRef.current;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const rawW = rect.right - e.clientX - SIDE_RAIL_GRIP_PX;
      const rowMax = Math.max(260, rect.width - SIDE_RAIL_MIN_MAIN_PX - SIDE_RAIL_GRIP_PX);
      const next = clampSideRailWidth(Math.min(rawW, rowMax));
      sideRailDragRef.current.lastW = next;
      setSideRailWidthPx(next);
    },
    [clampSideRailWidth]
  );

  const endSideRailDrag = useCallback(() => {
    const was = sideRailDragRef.current.active;
    sideRailDragRef.current.active = false;
    setSideRailResizing(false);
    if (was && sideRailStorageKey && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(sideRailStorageKey, String(sideRailDragRef.current.lastW));
      } catch {
        /* ignore quota */
      }
    }
  }, [sideRailStorageKey]);

  const startSideRailResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      sideRailDragRef.current = { active: true, lastW: sideRailWidthPx };
      setSideRailResizing(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      updateSideRailWidthFromPointer(e.nativeEvent);
    },
    [sideRailWidthPx, updateSideRailWidthFromPointer]
  );

  useEffect(() => {
    const fromState = location.state?.event as Event | undefined;
    if (fromState?.id) setEvent(fromState);
  }, [location.state]);

  const load = useCallback(async () => {
    if (!eventId) {
      setError('Missing event. Open Content Review from the Run of Show menu, or add ?eventId= to the URL.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [data, indentedRows] = await Promise.all([
        DatabaseService.getRunOfShowData(eventId),
        DatabaseService.getIndentedCues(eventId)
      ]);
      if (!data?.schedule_items?.length) {
        setSchedule([]);
        setCustomColumns((data?.custom_columns as CustomColumn[]) || []);
        setIndented(buildIndentedMap(indentedRows));
        setError('No schedule rows found for this event.');
        setLoading(false);
        return;
      }
      const items = (data.schedule_items as any[]).map(normalizeScheduleItem);
      setSchedule(items);
      setCustomColumns(Array.isArray(data.custom_columns) ? (data.custom_columns as CustomColumn[]) : []);
      setIndented(buildIndentedMap(indentedRows));
      setError(null);
    } catch (e) {
      console.error(e);
      setError('Could not load run of show data.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const cueLabel = useCallback((it: ScheduleItem) => {
    const raw = (it.customFields?.cue ?? '').toString().trim();
    return raw || `Row ${it.id}`;
  }, []);

  /** Roots in schedule order, each with its subtree (same order as ROS). */
  const cueGroups = useMemo(() => {
    const byRoot = new Map<number, ScheduleItem[]>();
    for (const it of schedule) {
      const r = rootIdFor(it.id, indented);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r)!.push(it);
    }
    const rootsInOrder: number[] = [];
    const seen = new Set<number>();
    for (const it of schedule) {
      const r = rootIdFor(it.id, indented);
      if (!seen.has(r)) {
        seen.add(r);
        rootsInOrder.push(r);
      }
    }
    return rootsInOrder.map((rootId) => ({ rootId, items: byRoot.get(rootId) ?? [] }));
  }, [schedule, indented]);

  useEffect(() => {
    if (!schedule.length) {
      setSelectedId(null);
      return;
    }
    if (selectedId == null || !schedule.some((r) => r.id === selectedId)) {
      setSelectedId(schedule[0].id);
    }
  }, [schedule, selectedId]);

  useEffect(() => {
    if (selectedId == null) return;
    const el = cueButtonRefs.current.get(selectedId);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  const selectedRow = useMemo(
    () => (selectedId == null ? null : schedule.find((r) => r.id === selectedId) ?? null),
    [schedule, selectedId]
  );
  const selectedReview = selectedRow ? cueReviews[selectedRow.id] : undefined;
  const selectedStatus: ReviewStatus = selectedReview?.status ?? 'pending';
  const selectedNote = selectedReview?.note ?? '';

  const setCueReviewStatus = useCallback(
    (itemId: number, status: ReviewStatus) => {
      setCueReviews((prev) => {
        const before = prev[itemId];
        return {
          ...prev,
          [itemId]: {
            status,
            note: before?.note ?? '',
            updatedAt: new Date().toISOString(),
            updatedBy: driverName
          }
        };
      });
    },
    [driverName]
  );

  const setCueReviewNote = useCallback(
    (itemId: number, note: string) => {
      setCueReviews((prev) => {
        const before = prev[itemId];
        return {
          ...prev,
          [itemId]: {
            status: before?.status ?? 'pending',
            note,
            updatedAt: new Date().toISOString(),
            updatedBy: driverName
          }
        };
      });
    },
    [driverName]
  );

  /** Main panel always shows the parent (root) row so subs share the parent’s full content. */
  const displayItem = useMemo(() => {
    if (selectedId == null) return null;
    const root = rootIdFor(selectedId, indented);
    return schedule.find((r) => r.id === root) ?? null;
  }, [schedule, selectedId, indented]);

  /** Sub-cues under the current parent (same group as sidebar), in run order — shown below parent in main column. */
  const subCuesUnderParent = useMemo(() => {
    if (!displayItem) return [];
    const group = cueGroups.find((g) => g.rootId === displayItem.id);
    if (!group) return [];
    return group.items.filter((it) => it.id !== displayItem.id);
  }, [cueGroups, displayItem]);

  const programColor = (pt: string) => PROGRAM_TYPE_COLORS[pt] || '#6B7280';
  const programTextClass = (pt: string) =>
    pt === 'Sub Cue' || pt === 'KILLED' ? 'text-black' : 'text-white';

  const pptQaString = (it: ScheduleItem) => {
    const parts: string[] = [];
    if (it.hasPPT) parts.push('PPT');
    if (it.hasQA) parts.push('Q&A');
    return parts.length ? parts.join(' / ') : 'None';
  };

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 z-0 flex flex-col bg-slate-900 text-white">
      {/* Slim top bar — page chrome; body does not scroll */}
      <header className="shrink-0 border-b border-slate-700 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 px-3 py-2.5 md:px-5">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2 md:gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-600 text-slate-300 hover:border-slate-500 hover:bg-slate-800 hover:text-white"
            aria-label="Go back"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="hidden h-7 w-px shrink-0 bg-slate-600/80 sm:block" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="relative top-1 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Content review
            </span>
            <h1 className="min-w-0 truncate text-base font-bold leading-tight text-white sm:text-lg md:text-xl">
              {event.name || eventNameParam || 'Event'}
            </h1>
            {followMode === 'drive' ? (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400/90">
                Driving — others can use Follow
              </span>
            ) : null}
          </div>
          <div
            className="flex shrink-0 rounded-lg border border-slate-600 bg-slate-800/50 p-0.5"
            role="group"
            aria-label="Cue sync mode"
          >
            {(
              [
                { mode: 'solo' as const, label: 'Solo' },
                { mode: 'drive' as const, label: 'Drive' },
                { mode: 'follow' as const, label: 'Follow' }
              ] as const
            ).map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setFollowMode(mode)}
                className={`rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide md:px-2.5 md:text-xs ${
                  followMode === mode
                    ? 'bg-slate-600 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={reviewPanelOpen}
            aria-label={reviewPanelOpen ? 'Hide review panel' : 'Show review panel'}
            onClick={() => setReviewPanelOpen((o) => !o)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg border-2 px-2.5 py-2 text-xs font-semibold shadow-sm md:px-3 md:text-sm ${
              reviewPanelOpen
                ? 'border-orange-300 bg-gradient-to-b from-orange-500 to-orange-600 text-white shadow-lg'
                : 'border-orange-500/60 bg-orange-950/40 text-orange-200 hover:border-orange-400/70 hover:bg-orange-900/35 hover:text-orange-100'
            }`}
          >
            <svg className="h-4 w-4 shrink-0 opacity-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            <span className="hidden sm:inline">Review</span>
          </button>
          <button
            type="button"
            aria-pressed={streamPanelOpen}
            aria-label={streamPanelOpen ? 'Hide stream panel' : 'Show stream panel'}
            onClick={() => {
              setStreamPanelOpen((open) => {
                if (open) return false;
                if (!savedStreamUrl) setStreamSetupOpen(true);
                return true;
              });
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg border-2 px-2.5 py-2 text-xs font-semibold shadow-sm md:px-3 md:text-sm ${
              streamPanelOpen
                ? 'border-emerald-300 bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-lg'
                : 'border-emerald-500/60 bg-emerald-950/40 text-emerald-200 hover:border-emerald-400/70 hover:bg-emerald-900/35 hover:text-emerald-100'
            }`}
          >
            <svg className="h-4 w-4 shrink-0 opacity-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <span className="hidden sm:inline">Stream</span>
          </button>
          <button
            type="button"
            aria-label="Refresh schedule"
            onClick={() => load()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-sky-300 bg-gradient-to-r from-blue-500 to-blue-600 px-2.5 py-2 text-xs font-semibold text-white shadow-md hover:from-blue-400 hover:to-blue-500 md:px-3 md:text-sm"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      {followMode === 'follow' ? (
        <div className="shrink-0 border-b border-emerald-900/40 bg-emerald-950/35 px-3 py-1.5 text-center text-xs text-emerald-100">
          Following live cue selection
          {followSourceName ? (
            <>
              {' '}
              from <span className="font-semibold text-white">{followSourceName}</span>
            </>
          ) : null}
          . Switch to <span className="font-medium">Solo</span> to use the cue list locally.
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8 text-slate-400">
          Loading schedule…
        </div>
      ) : error && !schedule.length ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8 text-amber-200">{error}</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          {/* Column 1: cue rail — scrolls independently */}
          <aside className="flex min-h-0 w-[11.5rem] shrink-0 flex-col border-r border-slate-700 bg-slate-950 md:w-[13.5rem]">
            <div className="shrink-0 border-b border-slate-800 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Cues
            </div>
            <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain py-1 pl-1 pr-0.5">
              {cueGroups.map(({ rootId, items }) => (
                <div
                  key={rootId}
                  className="mb-2 border-l-2 border-slate-600/90 pl-1.5"
                  title="Parent block above; sub-cue details scroll below in the main column."
                >
                  {items.map((it) => {
                    const killed = it.programType === 'KILLED';
                    const bar = programColor(it.programType);
                    const active = it.id === selectedId;
                    const isSub = it.id !== rootId;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        disabled={followMode === 'follow'}
                        ref={(el) => {
                          if (el) cueButtonRefs.current.set(it.id, el);
                          else cueButtonRefs.current.delete(it.id);
                        }}
                        onClick={() => setSelectedId(it.id)}
                        title={followMode === 'follow' ? 'Turn off Follow to select cues' : undefined}
                        className={`mb-0.5 flex w-full rounded-md border text-left transition-colors disabled:cursor-not-allowed ${
                          followMode === 'follow'
                            ? 'border-transparent'
                            : active
                              ? 'border-cyan-500/80 bg-slate-800 ring-1 ring-cyan-500/40'
                              : 'border-transparent bg-transparent hover:bg-slate-900'
                        }`}
                        style={{
                          textDecoration: killed ? 'line-through' : undefined,
                          opacity: followMode === 'follow' ? 0.55 : killed ? 0.75 : 1
                        }}
                      >
                        <div
                          className="w-1 shrink-0 self-stretch rounded-l-md"
                          style={{ backgroundColor: bar }}
                          aria-hidden
                        />
                        <div
                          className="min-w-0 flex-1 py-1.5 pl-1 pr-0.5"
                          style={{
                            paddingLeft: isSub ? `${4 + Math.min(depthFor(it.id, indented), 4) * 8}px` : '4px'
                          }}
                        >
                          <div className="truncate text-[11px] font-bold leading-tight text-white md:text-xs">
                            {isSub ? <span className="text-cyan-500/80">↳ </span> : null}
                            {formatCueDisplay(cueLabel(it))}
                          </div>
                          <div className="truncate text-[10px] text-slate-500 md:text-[11px]">
                            {it.segmentName || '—'}
                          </div>
                          <div className="mt-1">
                            <span
                              className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                                reviewStatusMeta(cueReviews[it.id]?.status ?? 'pending').railClass
                              }`}
                            >
                              {reviewStatusMeta(cueReviews[it.id]?.status ?? 'pending').label}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
          </aside>

          <div
            ref={sideRailResizeRowRef}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row"
            dir="ltr"
          >
            {/* Column 2: detail — scrolls independently from cue rail */}
            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain bg-slate-900 p-3 md:p-6">
            {!displayItem ? (
              <p className="text-slate-500">Select a cue from the list.</p>
            ) : (
              <div className="mx-auto max-w-5xl space-y-4">
                {selectedRow && selectedRow.id !== displayItem.id ? (
                  <div className="rounded-lg border border-cyan-700/50 bg-cyan-950/30 px-4 py-2.5 text-sm text-cyan-100">
                    <span className="text-slate-400">Selected sub-cue</span>{' '}
                    <span className="font-semibold text-white">{formatCueDisplay(cueLabel(selectedRow))}</span>
                    <span className="text-slate-400"> — main content is the parent cue </span>
                    <span className="font-semibold text-cyan-200">{formatCueDisplay(cueLabel(displayItem))}</span>
                  </div>
                ) : null}

                {/* Header strip — like Photo row top */}
                <div
                  className="overflow-hidden rounded-lg border border-slate-600 bg-slate-800 shadow-lg"
                  style={{
                    textDecoration: displayItem.programType === 'KILLED' ? 'line-through' : undefined,
                    opacity: displayItem.programType === 'KILLED' ? 0.85 : 1
                  }}
                >
                  <div className="grid grid-cols-12 gap-0 border-b border-slate-600">
                    <div className="col-span-12 border-b border-slate-600 bg-slate-800/90 p-4 sm:col-span-4 sm:border-b-0 sm:border-r md:col-span-3">
                      <div className="text-center sm:text-left">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cue</div>
                        <div
                          className={`mt-1 text-2xl font-bold md:text-3xl ${
                            displayItem.programType === 'KILLED' ? 'text-slate-400' : 'text-white'
                          }`}
                        >
                          {formatCueDisplay(cueLabel(displayItem))}
                        </div>
                        <div
                          className="mt-2 inline-block rounded border px-2 py-1 text-xs font-semibold shadow-md"
                          style={{
                            backgroundColor: programColor(displayItem.programType),
                            color: programTextClass(displayItem.programType),
                            borderColor: displayItem.programType === 'Sub Cue' ? '#000' : 'transparent'
                          }}
                        >
                          {displayItem.programType || 'Unknown'}
                        </div>
                      </div>
                    </div>
                    <div className="col-span-6 border-r border-slate-600 p-4 sm:col-span-4 md:col-span-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Day</div>
                      <div className="mt-1 text-xl font-bold text-white">Day {displayItem.day}</div>
                      {displayItem.isStartCue ? (
                        <div className="mt-1 text-xs font-bold text-amber-400">START</div>
                      ) : null}
                    </div>
                    <div className="col-span-6 p-4 sm:col-span-4 md:col-span-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Duration</div>
                      <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-white md:text-3xl">
                        {formatDurationClock(displayItem)}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">{formatDurationShort(displayItem)}</div>
                    </div>
                    <div className="col-span-12 bg-slate-800/70 p-4 sm:col-span-12 md:col-span-3 md:border-l md:border-slate-600">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Segment</div>
                      <div className="mt-1 text-lg font-bold leading-snug text-white md:text-xl">
                        {displayItem.segmentName || 'Untitled segment'}
                      </div>
                    </div>
                  </div>

                  {/* Second row: shot + PPT/Q&A */}
                  <div className="grid grid-cols-1 gap-0 border-b border-slate-600 sm:grid-cols-2">
                    <div className="border-b border-slate-600 p-4 sm:border-b-0 sm:border-r">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Shot</div>
                      <div className="mt-1 text-base font-bold text-white">{displayItem.shotType || '—'}</div>
                    </div>
                    <div className="p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">PPT / Q&A</div>
                      <div className="mt-1 text-base font-bold text-white">{pptQaString(displayItem)}</div>
                    </div>
                  </div>
                </div>

                {/* Speaker slots — Photo print row */}
                <div className="overflow-hidden rounded-lg border border-slate-600 bg-slate-800">
                  <div className="border-b border-slate-600 bg-slate-700 px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-slate-200">
                    Speakers (slots 1–7)
                  </div>
                  <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-4 lg:grid-cols-7">
                    {parseSpeakersSlots(displayItem.speakersText).map((cell, i) => (
                      <div
                        key={i}
                        className="flex min-h-[5.5rem] flex-col justify-start rounded border border-slate-600 bg-slate-900/50 p-2 text-center"
                      >
                        <div className="text-[10px] font-bold uppercase text-slate-500">Slot {i + 1}</div>
                        <div className="mt-1 whitespace-pre-line text-xs font-semibold leading-snug text-white">
                          {cell || '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Notes — full width block */}
                <div className="rounded-lg border border-slate-600 bg-slate-800">
                  <div className="border-b border-slate-600 bg-slate-700 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-200">
                    Notes
                  </div>
                  <div className="min-h-[4rem] whitespace-pre-wrap break-words p-4 text-sm leading-relaxed text-slate-100">
                    {displayItem.notes?.trim() ? displayItem.notes : <span className="text-slate-500">No notes</span>}
                  </div>
                </div>

                {/* Assets */}
                <div className="rounded-lg border border-slate-600 bg-slate-800">
                  <div className="border-b border-slate-600 bg-slate-700 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-200">
                    Assets
                  </div>
                  <div className="break-all p-4 text-sm text-cyan-200">
                    {displayItem.assets?.trim() ? displayItem.assets : <span className="text-slate-500">None</span>}
                  </div>
                </div>

                {/* Custom columns grid */}
                {(() => {
                  const cols = customColumns.filter(
                    (col) => (displayItem.customFields?.[col.id] ?? '').toString().trim().length > 0
                  );
                  if (!cols.length) return null;
                  return (
                    <div className="rounded-lg border border-slate-600 bg-slate-800">
                      <div className="border-b border-slate-600 bg-slate-700 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-200">
                        Custom columns
                      </div>
                      <div className="grid gap-0 sm:grid-cols-2">
                        {cols.map((col) => (
                          <div
                            key={col.id}
                            className="border-b border-slate-700 p-3 sm:border-r sm:[&:nth-child(2n)]:border-r-0"
                          >
                            <div className="text-[10px] font-semibold uppercase text-slate-500">{col.name}</div>
                            <div className="mt-1 whitespace-pre-wrap text-sm text-slate-100">
                              {(displayItem.customFields?.[col.id] ?? '').toString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {subCuesUnderParent.length > 0 ? (
                  <section className="border-t border-slate-700 pt-6">
                    <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">
                      Sub-cues ({subCuesUnderParent.length})
                    </h2>
                    <div className="space-y-4">
                      {subCuesUnderParent.map((sub) => {
                        const isSubSelected = selectedRow?.id === sub.id;
                        const subKilled = sub.programType === 'KILLED';
                        const subBar = programColor(sub.programType);
                        const subCols = customColumns.filter(
                          (col) => (sub.customFields?.[col.id] ?? '').toString().trim().length > 0
                        );
                        return (
                          <div
                            key={sub.id}
                            className={`flex overflow-hidden rounded-lg border bg-slate-800/95 shadow-md ${
                              isSubSelected
                                ? 'border-cyan-500 ring-2 ring-cyan-500/40'
                                : 'border-slate-600'
                            }`}
                            style={{
                              textDecoration: subKilled ? 'line-through' : undefined,
                              opacity: subKilled ? 0.8 : 1
                            }}
                          >
                            <div
                              className="w-1 shrink-0 self-stretch"
                              style={{ backgroundColor: subBar }}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1 space-y-3 p-3 md:p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-700/80 pb-3">
                                <div>
                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                    Sub-cue
                                  </div>
                                  <div
                                    className={`mt-0.5 text-lg font-bold md:text-xl ${
                                      subKilled ? 'text-slate-400' : 'text-white'
                                    }`}
                                  >
                                    <span className="text-cyan-500/90">↳ </span>
                                    {formatCueDisplay(cueLabel(sub))}
                                  </div>
                                  <div
                                    className="mt-1.5 inline-block rounded border px-2 py-0.5 text-[10px] font-semibold"
                                    style={{
                                      backgroundColor: subBar,
                                      color: programTextClass(sub.programType),
                                      borderColor: sub.programType === 'Sub Cue' ? '#000' : 'transparent'
                                    }}
                                  >
                                    {sub.programType || 'Unknown'}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-[10px] font-semibold uppercase text-slate-500">Day</div>
                                  <div className="text-sm font-bold text-white">Day {sub.day}</div>
                                  <div className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-200">
                                    {formatDurationClock(sub)}
                                  </div>
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] font-semibold uppercase text-slate-500">Segment</div>
                                <div className="text-base font-semibold leading-snug text-white">
                                  {sub.segmentName || '—'}
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                                <div>
                                  <div className="text-[10px] uppercase text-slate-500">Shot</div>
                                  <div className="font-medium text-slate-100">{sub.shotType || '—'}</div>
                                </div>
                                <div>
                                  <div className="text-[10px] uppercase text-slate-500">PPT / Q&A</div>
                                  <div className="font-medium text-slate-100">{pptQaString(sub)}</div>
                                </div>
                              </div>
                              <div className="rounded border border-slate-600 bg-slate-900/40">
                                <div className="border-b border-slate-600 bg-slate-700/80 px-2 py-1 text-center text-[10px] font-bold uppercase text-slate-300">
                                  Speakers (1–7)
                                </div>
                                <div className="grid grid-cols-2 gap-1 p-1.5 sm:grid-cols-4 lg:grid-cols-7">
                                  {parseSpeakersSlots(sub.speakersText).map((cell, i) => (
                                    <div
                                      key={i}
                                      className="rounded border border-slate-700 bg-slate-900/60 p-1.5 text-center"
                                    >
                                      <div className="text-[9px] font-bold uppercase text-slate-500">{i + 1}</div>
                                      <div className="mt-0.5 whitespace-pre-line text-[10px] font-medium leading-tight text-slate-200">
                                        {cell || '—'}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              {sub.notes?.trim() ? (
                                <div>
                                  <div className="text-[10px] font-semibold uppercase text-slate-500">Notes</div>
                                  <div className="mt-1 whitespace-pre-wrap rounded border border-slate-700 bg-slate-900/50 p-2 text-xs text-slate-200">
                                    {sub.notes}
                                  </div>
                                </div>
                              ) : null}
                              {sub.assets?.trim() ? (
                                <div>
                                  <div className="text-[10px] font-semibold uppercase text-slate-500">Assets</div>
                                  <div className="mt-1 break-all text-xs text-cyan-200/90">{sub.assets}</div>
                                </div>
                              ) : null}
                              {subCols.length > 0 ? (
                                <div className="rounded border border-slate-600">
                                  <div className="border-b border-slate-600 bg-slate-700/80 px-2 py-1 text-[10px] font-bold uppercase text-slate-300">
                                    Custom columns
                                  </div>
                                  <div className="grid gap-0 p-2 sm:grid-cols-2">
                                    {subCols.map((col) => (
                                      <div key={col.id} className="border-b border-slate-800 py-1.5 sm:border-r sm:px-2">
                                        <div className="text-[9px] font-semibold uppercase text-slate-500">{col.name}</div>
                                        <div className="whitespace-pre-wrap text-xs text-slate-200">
                                          {(sub.customFields?.[col.id] ?? '').toString()}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </div>
            )}
            </main>

            {(reviewPanelOpen || streamPanelOpen) && isLgLayout ? (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize main content and review or stream column"
                aria-valuemin={260}
                aria-valuemax={680}
                aria-valuenow={Math.round(sideRailWidthPx)}
                onPointerDown={startSideRailResize}
                onPointerMove={(e) => {
                  if (!sideRailDragRef.current.active) return;
                  e.preventDefault();
                  updateSideRailWidthFromPointer(e.nativeEvent);
                }}
                onPointerUp={(e) => {
                  if (!sideRailDragRef.current.active) return;
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  } catch {
                    /* ignore */
                  }
                  endSideRailDrag();
                }}
                onPointerCancel={() => {
                  endSideRailDrag();
                }}
                onLostPointerCapture={() => {
                  endSideRailDrag();
                }}
                className="group relative z-[1] hidden w-3 shrink-0 cursor-col-resize select-none touch-none lg:block"
              >
                <div
                  className="absolute inset-y-4 left-1/2 w-px -translate-x-1/2 bg-slate-600 group-hover:bg-slate-400 group-active:bg-slate-300"
                  aria-hidden
                />
              </div>
            ) : null}

            {reviewPanelOpen || streamPanelOpen ? (
              <div
                className="flex min-h-0 w-full shrink-0 flex-col border-t border-slate-700 bg-slate-950 lg:min-h-0 lg:max-w-none lg:flex-shrink-0 lg:grow-0 lg:border-l lg:border-t-0 lg:overflow-hidden"
                style={isLgLayout ? { flex: `0 0 ${sideRailWidthPx}px`, width: sideRailWidthPx } : undefined}
              >
                {reviewPanelOpen ? (
                  <section
                    className={`flex min-h-0 flex-1 flex-col border-l-4 border-orange-500 bg-transparent lg:min-h-0 ${streamPanelOpen ? 'border-b border-orange-800/70' : ''}`}
                    aria-label="Cue review"
                  >
                    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-orange-600/45 bg-transparent px-2 py-2">
                      <span className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-orange-100">
                        Cue review
                      </span>
                      <button
                        type="button"
                        onClick={() => setReviewPanelOpen(false)}
                        className="rounded border border-orange-400/60 bg-transparent px-2 py-1 text-[10px] font-medium text-orange-50 hover:bg-transparent"
                      >
                        Hide
                      </button>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain p-2">
                      {selectedRow ? (
                        <>
                          <div className="flex flex-wrap gap-1.5">
                            {(
                              [
                                {
                                  id: 'pending' as const,
                                  label: 'Review',
                                  activeClass: 'border-sky-100 bg-sky-500 text-white shadow-lg',
                                  idleClass:
                                    'border-sky-600 bg-sky-800 text-sky-50 hover:bg-sky-700 hover:border-sky-500'
                                },
                                {
                                  id: 'needs_update' as const,
                                  label: 'Needs Review',
                                  activeClass: 'border-amber-50 bg-amber-500 text-white shadow-lg',
                                  idleClass:
                                    'border-amber-600 bg-amber-800 text-amber-50 hover:bg-amber-700 hover:border-amber-500'
                                },
                                {
                                  id: 'approved' as const,
                                  label: 'Approved',
                                  activeClass: 'border-emerald-50 bg-emerald-500 text-white shadow-lg',
                                  idleClass:
                                    'border-emerald-600 bg-emerald-800 text-emerald-50 hover:bg-emerald-700 hover:border-emerald-500'
                                }
                              ] as const
                            ).map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => setCueReviewStatus(selectedRow.id, s.id)}
                                className={`rounded border px-2 py-1 text-[11px] font-semibold ${
                                  selectedStatus === s.id ? `${s.activeClass} shadow-sm` : s.idleClass
                                }`}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                          <textarea
                            value={selectedNote}
                            onChange={(e) => setCueReviewNote(selectedRow.id, e.target.value)}
                            rows={6}
                            placeholder="Review notes…"
                            className="min-h-[10rem] w-full flex-1 resize-y rounded border-2 border-slate-300 bg-white px-2 py-2 text-xs text-slate-900 shadow-inner outline-none placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/40"
                          />
                        </>
                      ) : (
                        <p className="text-xs text-orange-200/80">Select a cue from the list to add review notes.</p>
                      )}
                    </div>
                  </section>
                ) : null}
                {streamPanelOpen ? (
              <section
                className="flex min-h-[200px] w-full flex-1 flex-col border-t border-slate-800 bg-slate-950 lg:min-h-0 lg:border-t-0"
                aria-label="Embedded stream"
              >
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 px-2 py-2">
                  <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Live embed
                  </span>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {savedStreamUrl && !streamSetupOpen ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setStreamUrlDraft(savedStreamUrl);
                            setStreamSetupOpen(true);
                          }}
                          className="rounded border border-slate-600 px-2 py-1 text-[10px] font-medium text-slate-300 hover:bg-slate-800"
                        >
                          Change URL
                        </button>
                        <button
                          type="button"
                          onClick={() => window.open(savedStreamUrl, '_blank', 'noopener,noreferrer')}
                          className="rounded border border-slate-600 px-2 py-1 text-[10px] font-medium text-slate-300 hover:bg-slate-800"
                        >
                          Open tab
                        </button>
                        <button
                          type="button"
                          onClick={() => savedStreamUrl && setStreamFloatOpen(true)}
                          className="flex items-center gap-1 rounded border border-emerald-600/60 bg-emerald-950/45 px-2 py-1 text-[10px] font-medium text-emerald-100 hover:bg-emerald-900/55"
                          title="Open stream in a floating window on this page"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                          Pop out
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setStreamPanelOpen(false)}
                      className="rounded border border-slate-600 px-2 py-1 text-[10px] font-medium text-slate-300 hover:bg-slate-800"
                    >
                      Hide
                    </button>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
                  {savedStreamUrl && !streamSetupOpen ? (
                    <div className="flex min-h-0 flex-1 flex-col">
                      <div className="min-h-0 flex-1 overflow-hidden rounded border border-slate-700 bg-black shadow-inner">
                        <iframe
                          key={savedStreamUrl}
                          src={savedStreamUrl}
                          title="Embedded stream"
                          className="h-full min-h-[200px] w-full border-0 lg:min-h-[280px]"
                          allow="camera; microphone; fullscreen; display-capture; autoplay"
                          referrerPolicy="no-referrer-when-downgrade"
                        />
                      </div>
                      <p className="shrink-0 text-[10px] leading-snug text-slate-500">
                        If this stays blank, the site may block embedding—use Open tab.
                      </p>
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col gap-2">
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Viewer URL (https)
                      </label>
                      <textarea
                        value={streamUrlDraft}
                        onChange={(e) => setStreamUrlDraft(e.target.value)}
                        rows={3}
                        placeholder="https://…"
                        className="w-full resize-y rounded border border-slate-600 bg-slate-900 px-2 py-2 font-mono text-[11px] text-slate-100 placeholder:text-slate-600"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={applyStreamUrl}
                          className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-900/40"
                        >
                          Save & load
                        </button>
                        {savedStreamUrl ? (
                          <button
                            type="button"
                            onClick={() => setStreamSetupOpen(false)}
                            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                          >
                            Cancel
                          </button>
                        ) : null}
                        {savedStreamUrl ? (
                          <button
                            type="button"
                            onClick={clearStreamUrl}
                            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                      <p className="text-[10px] leading-snug text-slate-500">
                        Add <span className="font-mono text-slate-400">streamUrl</span> to the page query (URL-encoded),
                        or paste a viewer link here. Only <span className="font-mono text-slate-400">http:</span> /{' '}
                        <span className="font-mono text-slate-400">https:</span> URLs are accepted.
                      </p>
                    </div>
                  )}
                </div>
              </section>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {streamFloatOpen && savedStreamUrl ? (
        <div
          className="pointer-events-auto fixed z-[70] flex flex-col overflow-hidden rounded-xl border-2 border-emerald-500 bg-slate-950 shadow-[0_20px_50px_rgba(0,0,0,0.55)]"
          role="dialog"
          aria-modal="true"
          aria-label="Floating stream player"
          style={{
            left: `${streamFloatRect.left}px`,
            top: `${streamFloatRect.top}px`,
            width: `${streamFloatRect.width}px`,
            height: `${streamFloatRect.height}px`
          }}
        >
          <div
            className="flex shrink-0 cursor-move select-none items-center justify-between gap-2 border-b border-emerald-800/70 bg-emerald-950/60 px-3 py-2"
            onPointerDown={startDragStreamFloat}
          >
            <span className="text-xs font-semibold text-emerald-200">Stream (floating)</span>
            <button
              type="button"
              onClick={() => setStreamFloatOpen(false)}
              className="rounded border border-slate-600 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800"
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 bg-black p-1">
            <iframe
              key={`float-${savedStreamUrl}`}
              src={savedStreamUrl}
              title="Floating embedded stream"
              className="h-full w-full border-0"
              allow="camera; microphone; fullscreen; display-capture; autoplay"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <div
            className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize rounded-tl border-l border-t border-emerald-700/60 bg-emerald-900/40"
            onPointerDown={startResizeStreamFloat}
            title="Resize"
            aria-hidden
          />
        </div>
      ) : null}
    </div>
  );
};

export default ContentReviewPage;
