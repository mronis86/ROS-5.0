import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessAccessManager, canAccessCatering } from '../services/auth-service';
import { apiClient, getApiBaseUrl, type CateringNoteRow } from '../services/api-client';
import { DatabaseService } from '../services/database';
import { apiAuthFetch } from '../lib/sessionAuth';
import { socketClient } from '../services/socket-client';
import {
  findParentScheduleIndex,
  isIndentedScheduleItem,
} from '../lib/scheduleStartTime';
import {
  CATERING_NOTE_CATEGORIES,
  CATERING_NOTE_CATEGORY_LABELS,
  isCateringRelevantProgramType,
  normalizeCateringNoteCategory,
  type CateringNoteCategory,
} from '../lib/cateringNotes';

type ScheduleItem = {
  id: number;
  day?: number;
  programType?: string;
  segmentName?: string;
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
  notes?: string;
  isIndented?: boolean;
  customFields?: { cue?: string };
};

type ViewMode = 'plan' | 'follow';

const TYPE_COLOR: Record<string, string> = {
  'Podium Transition': '#8B4513',
  'Panel Transition': '#404040',
  'Sub Cue': '#6B7280',
  'No Transition': '#059669',
  Video: '#F59E0B',
  'Panel+Remote': '#1E40AF',
  'Remote Only': '#60A5FA',
  'Break F&B/B2B': '#EC4899',
  'Breakout Session': '#20B2AA',
  'Delay Block': '#7C3AED',
  TBD: '#6B7280',
  KILLED: '#DC2626',
  Podium: '#8B4513',
  Panel: '#404040',
  'PreShow/End': '#8B5CF6',
  'Full-Stage/Ted-Talk': '#EA580C',
};

function formatDuration(item: ScheduleItem): string {
  const h = Math.max(0, Math.floor(Number(item.durationHours) || 0));
  const m = Math.max(0, Math.floor(Number(item.durationMinutes) || 0));
  const s = Math.max(0, Math.floor(Number(item.durationSeconds) || 0));
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function durationSeconds(item: ScheduleItem): number {
  return (
    (Number(item.durationHours) || 0) * 3600 +
    (Number(item.durationMinutes) || 0) * 60 +
    (Number(item.durationSeconds) || 0)
  );
}

function formatCue(item: ScheduleItem): string {
  const raw = String(item.customFields?.cue || '').trim();
  if (!raw) return '—';
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

function progressBarColor(remaining: number): string {
  if (remaining < 0) return '#ef4444';
  if (remaining > 120) return '#10b981';
  if (remaining > 30) return '#f59e0b';
  return '#ef4444';
}

function as12(h24: number, mins: number): string {
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h = h24 % 12 || 12;
  return `${h}:${String(mins).padStart(2, '0')} ${period}`;
}

function rowHighlight(active: boolean, running: boolean): string {
  if (!active) return 'border border-slate-600 bg-slate-900';
  if (running) return 'border-4 border-green-400 bg-green-950';
  return 'border-4 border-blue-400 bg-blue-950';
}

function completedDimStyle(dimmed: boolean): React.CSSProperties | undefined {
  if (!dimmed) return undefined;
  return { opacity: 0.68, filter: 'brightness(0.59) saturate(0.33)' };
}

const DELAY_ROW_BG: React.CSSProperties = {
  backgroundColor: '#2e1065',
  backgroundImage:
    'repeating-linear-gradient(135deg, rgba(167,139,250,0.18) 0, rgba(167,139,250,0.18) 10px, rgba(46,16,101,0.14) 10px, rgba(46,16,101,0.14) 20px)',
};

function parseCompletedMap(raw: unknown): Record<number, boolean> {
  const map: Record<number, boolean> = {};
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.value) ? (raw as any).value : [];
  for (const cue of list) {
    const id = Number((cue as any)?.item_id);
    if (Number.isFinite(id)) map[id] = true;
  }
  return map;
}

function noteItemId(note: CateringNoteRow): number | null {
  if (note.schedule_item_id == null) return null;
  const n = Number(note.schedule_item_id);
  return Number.isFinite(n) ? n : null;
}

const CateringEventPage: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const eventId = params.get('eventId') || '';
  const eventNameParam = params.get('eventName') || '';

  const [eventName, setEventName] = useState(eventNameParam);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [masterStart, setMasterStart] = useState('09:00');
  const [dayStarts, setDayStarts] = useState<Record<string, string>>({});
  const [indented, setIndented] = useState<Record<number, unknown>>({});
  const [day, setDay] = useState(1);
  const [notes, setNotes] = useState<CateringNoteRow[]>([]);
  const [completedCues, setCompletedCues] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timer, setTimer] = useState<any | null>(null);
  const [offset, setOffset] = useState(0);
  const [progress, setProgress] = useState({ elapsed: 0, total: 0 });
  const [now, setNow] = useState(() => new Date());
  const [filterBreaks, setFilterBreaks] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('follow');
  const [mobilePanel, setMobilePanel] = useState<'schedule' | 'notes'>('schedule');
  const [notesFilter, setNotesFilter] = useState<'all' | 'active'>('all');

  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [modalItem, setModalItem] = useState<ScheduleItem | null>(null);
  const [category, setCategory] = useState<CateringNoteCategory>('plating');
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const syncRef = useRef<(() => Promise<void>) | null>(null);
  const activeNoteRef = useRef<HTMLLIElement | null>(null);

  const allowed = canAccessCatering(user);
  const canEditNotes = canAccessAccessManager(user);

  const loadStatic = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [ros, notesRes, completedRes] = await Promise.all([
        DatabaseService.getRunOfShowData(eventId),
        apiClient.getCateringNotes(eventId).catch((err) => {
          console.warn('Catering notes unavailable (ignored for UI):', err);
          return { notes: [] as CateringNoteRow[] };
        }),
        apiClient.getCompletedCues(eventId).catch((err) => {
          console.warn('Completed cues unavailable:', err);
          return [];
        }),
      ]);
      const items = Array.isArray(ros?.schedule_items) ? ros.schedule_items : [];
      setSchedule(items);
      setEventName(ros?.event_name || eventNameParam || 'Event');
      setNotes(
        (notesRes?.notes || []).map((n) => ({
          ...n,
          schedule_item_id: noteItemId(n),
          category: normalizeCateringNoteCategory(n.category),
        }))
      );
      setCompletedCues(parseCompletedMap(completedRes));
      if (ros?.settings?.masterStartTime) setMasterStart(String(ros.settings.masterStartTime));
      if (ros?.settings?.dayStartTimes && typeof ros.settings.dayStartTimes === 'object') {
        setDayStarts(ros.settings.dayStartTimes as Record<string, string>);
      }
      if (ros?.settings?.indentedCues && typeof ros.settings.indentedCues === 'object') {
        setIndented(ros.settings.indentedCues as Record<number, unknown>);
      }
      const maxDay = items.reduce((m: number, s: any) => Math.max(m, Number(s.day) || 1), 1);
      if (maxDay >= 1) setDay((d) => Math.min(d, maxDay));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load event');
    } finally {
      setLoading(false);
    }
  }, [eventId, eventNameParam]);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) {
      navigate('/', { replace: true });
      return;
    }
    void loadStatic();
  }, [allowed, authLoading, loadStatic, navigate]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!eventId || !allowed) return;
    let dead = false;

    const apply = (raw: any) => {
      if (dead) return;
      // Normalize list/object payloads from API or socket.
      let t: any = raw;
      if (Array.isArray(raw)) {
        t =
          raw.find((x: any) => x?.is_running && x?.is_active !== false) ||
          raw.find((x: any) => x?.is_active) ||
          null;
      } else if (raw?.value && Array.isArray(raw.value)) {
        const list = raw.value;
        t =
          list.find((x: any) => x?.is_running && x?.is_active !== false) ||
          list.find((x: any) => x?.is_active) ||
          null;
      }

      // Reset / no cue selected: clear completely (do not keep previous item_id).
      if (
        !t ||
        t.is_active === false ||
        t.cleared === true ||
        (t.item_id == null && t.itemId == null)
      ) {
        setTimer(null);
        setProgress({ elapsed: 0, total: 0 });
        return;
      }
      setTimer(t);
    };

    const boot = async () => {
      try {
        const res = await apiAuthFetch(`${getApiBaseUrl()}/api/active-timers/${eventId}`);
        if (!res || dead) return;
        if (!res.ok) {
          apply(null);
          return;
        }
        const raw = await res.json();
        if (!dead) apply(raw);
      } catch {
        if (!dead) apply(null);
      }
    };
    syncRef.current = boot;
    void boot();

    const cb = {
      onServerTime: (d: any) => {
        if (d?.serverTime) setOffset(new Date(d.serverTime).getTime() - Date.now());
      },
      onTimerUpdated: (d: any) => apply(d),
      onTimerStarted: (d: any) => apply(d),
      onTimerStopped: () => {
        apply(null);
        void syncRef.current?.();
      },
      onTimersStopped: () => {
        apply(null);
        void syncRef.current?.();
      },
      onResetAllStates: () => {
        apply(null);
        setProgress({ elapsed: 0, total: 0 });
      },
      onCompletedCuesUpdated: (data: any) => {
        if (data?.cleared) {
          setCompletedCues({});
          return;
        }
        if (data?.removed && data.item_id != null) {
          const id = Number(data.item_id);
          setCompletedCues((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          return;
        }
        if (Array.isArray(data)) {
          setCompletedCues(parseCompletedMap(data));
          return;
        }
        if (data?.item_id != null) {
          const id = Number(data.item_id);
          if (Number.isFinite(id)) {
            setCompletedCues((prev) => ({ ...prev, [id]: true }));
          }
        }
      },
      onInitialSync: () => {
        void boot();
        void apiClient
          .getCompletedCues(eventId)
          .then((res) => {
            if (!dead) setCompletedCues(parseCompletedMap(res));
          })
          .catch(() => {});
      },
      onConnectionChange: () => {},
    };
    socketClient.connect(eventId, cb);
    return () => {
      dead = true;
      socketClient.disconnect(eventId);
    };
  }, [eventId, allowed]);

  useEffect(() => {
    const running = timer?.timer_state === 'running' || (timer?.is_running && timer?.is_active);
    if (running && timer?.started_at) {
      const start = new Date(timer.started_at).getTime();
      const total = timer.duration_seconds || 0;
      const tick = () =>
        setProgress({ elapsed: Math.floor((Date.now() + offset - start) / 1000), total });
      tick();
      const iv = setInterval(tick, 1000);
      return () => clearInterval(iv);
    }
    if (timer) {
      setProgress({ elapsed: timer.elapsed_seconds || 0, total: timer.duration_seconds || 0 });
    } else {
      setProgress({ elapsed: 0, total: 0 });
    }
  }, [timer, offset]);

  const baseStart = useCallback(
    (full: ScheduleItem[], index: number): string => {
      const item = full[index];
      if (!item) return '';
      if (isIndentedScheduleItem(item, indented)) {
        const p = findParentScheduleIndex(full, index, indented);
        return p < 0 ? '' : baseStart(full, p);
      }
      const d = item.day || 1;
      const start = dayStarts[String(d)] || masterStart;
      if (!start) return '';
      let secs = 0;
      for (let i = 0; i < index; i++) {
        const it = full[i];
        if ((it.day || 1) === d && !isIndentedScheduleItem(it, indented)) {
          secs += durationSeconds(it);
        }
      }
      const [hh, mm] = start.split(':').map(Number);
      const total = (hh || 0) * 3600 + (mm || 0) * 60 + secs;
      return as12(Math.floor(total / 3600) % 24, Math.floor((total % 3600) / 60));
    },
    [dayStarts, indented, masterStart]
  );

  const days = useMemo(() => {
    const set = new Set(schedule.map((s) => s.day || 1));
    return [...set].sort((a, b) => a - b);
  }, [schedule]);

  const activeId =
    timer != null && timer.is_active !== false && timer.item_id != null
      ? Number(timer.item_id)
      : null;
  const current = useMemo(
    () => (activeId != null ? schedule.find((s) => s.id === activeId) || null : null),
    [activeId, schedule]
  );

  /** Completed cues dim; never dim the currently loaded/running cue. */
  const isCueDimmed = useCallback(
    (itemId: number) => {
      if (activeId != null && itemId === activeId) return false;
      return Boolean(completedCues[itemId]);
    },
    [activeId, completedCues]
  );

  const noteCountByItem = useMemo(() => {
    const map = new Map<number, number>();
    for (const n of notes) {
      const id = noteItemId(n);
      if (id == null) continue;
      map.set(id, (map.get(id) || 0) + 1);
    }
    return map;
  }, [notes]);

  const activeCueNoteCount = activeId != null ? noteCountByItem.get(activeId) || 0 : 0;

  const dayRows = useMemo(() => {
    let rows = schedule
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => (item.day || 1) === day);
    if (filterBreaks) {
      rows = rows.filter(({ item }) => isCateringRelevantProgramType(item.programType));
    }
    return rows;
  }, [schedule, day, filterBreaks]);

  const scheduleById = useMemo(() => {
    const map = new Map<number, ScheduleItem>();
    for (const s of schedule) map.set(s.id, s);
    return map;
  }, [schedule]);

  const sortedNotes = useMemo(() => {
    const list = [...notes].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    if (notesFilter === 'active' && activeId != null) {
      return list.filter((n) => noteItemId(n) === activeId);
    }
    return list;
  }, [notes, notesFilter, activeId]);

  useEffect(() => {
    if (viewMode === 'follow' && current?.day) setDay(current.day || 1);
  }, [current?.id, current?.day, viewMode]);

  // Follow mode: keep the loaded/running cue visible (same pattern as Mic Manager).
  useEffect(() => {
    if (viewMode !== 'follow' || activeId == null) return;
    // Ensure schedule panel is showing on mobile/tablet so the row exists in the DOM.
    setMobilePanel('schedule');
    // If Breaks-only is hiding the live cue, show all rows so Follow can land on it.
    if (filterBreaks) {
      const activeItem = schedule.find((s) => s.id === activeId);
      if (activeItem && !isCateringRelevantProgramType(activeItem.programType)) {
        setFilterBreaks(false);
      }
    }
    const scrollToActive = () => {
      // Mobile cards + desktop table both render; pick the currently visible one.
      const nodes = document.querySelectorAll<HTMLElement>(`[data-catering-row="${activeId}"]`);
      const el = Array.from(nodes).find((n) => n.getClientRects().length > 0) || null;
      if (!el) return;

      // Prefer scrolling the schedule pane so the cue sits near the top (under sticky header).
      const scrollParent = ((): HTMLElement | null => {
        let node: HTMLElement | null = el.parentElement;
        while (node && node !== document.body) {
          const style = window.getComputedStyle(node);
          const overflowY = style.overflowY;
          if (
            (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
            node.scrollHeight > node.clientHeight + 4
          ) {
            return node;
          }
          node = node.parentElement;
        }
        return null;
      })();

      const TOP_PAD = 56; // leave room for sticky column headers / breathing room
      if (scrollParent) {
        const parentRect = scrollParent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const delta = elRect.top - parentRect.top - TOP_PAD;
        scrollParent.scrollBy({ top: delta, behavior: 'smooth' });
      } else {
        // Page scroll (mobile cards): put cue near top of viewport under app chrome.
        const y = el.getBoundingClientRect().top + window.scrollY - TOP_PAD - 80;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }
    };
    // Wait for day/filter re-render before scrolling.
    const t1 = window.setTimeout(scrollToActive, 50);
    const t2 = window.setTimeout(scrollToActive, 250);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [viewMode, activeId, day, filterBreaks, dayRows, schedule]);

  const firstActiveNoteId = useMemo(() => {
    if (activeId == null) return null;
    const hit = sortedNotes.find((n) => noteItemId(n) === activeId);
    return hit?.id ?? null;
  }, [sortedNotes, activeId]);

  useEffect(() => {
    if (!firstActiveNoteId) return;
    const t = window.setTimeout(() => {
      activeNoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
    return () => window.clearTimeout(t);
  }, [firstActiveNoteId, mobilePanel, notesFilter]);

  const remainingSeconds = progress.total - progress.elapsed;
  const timerRunning = Boolean(
    timer &&
      timer.is_active !== false &&
      (timer.timer_state === 'running' || timer.is_running)
  );
  const timerLoaded = Boolean(timer && timer.is_active !== false && !timerRunning);
  const hasTimer = Boolean(activeId != null && (timerRunning || timerLoaded) && progress.total > 0);
  const remainingPct =
    hasTimer && remainingSeconds >= 0 && progress.total > 0
      ? (remainingSeconds / progress.total) * 100
      : 0;
  const statusLine = timerRunning ? 'RUNNING' : timerLoaded ? 'LOADED' : 'NO TIMER';
  const statusClass = timerRunning
    ? 'text-green-400'
    : timerLoaded
      ? 'text-blue-400'
      : 'text-slate-400';

  const openNoteModal = (item: ScheduleItem) => {
    setModalItem(item);
    setCategory(isCateringRelevantProgramType(item.programType) ? 'break' : 'plating');
    setNoteText('');
    setModalError(null);
    setNoteModalOpen(true);
  };

  const closeNoteModal = () => {
    if (savingNote) return;
    setNoteModalOpen(false);
    setModalItem(null);
    setNoteText('');
    setModalError(null);
  };

  const saveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id || !eventId || !noteText.trim() || !modalItem) return;
    setSavingNote(true);
    setModalError(null);
    try {
      const created = await apiClient.createCateringNote({
        event_id: eventId,
        user_id: user.id,
        user_name: user.full_name || user.email,
        category,
        content: noteText.trim(),
        schedule_item_id: modalItem.id,
      });
      // Normalize + fill gaps so the list card renders correctly right away.
      const normalized: CateringNoteRow = {
        ...created,
        id: String(created?.id || crypto.randomUUID()),
        event_id: created?.event_id || eventId,
        user_id: created?.user_id || user.id,
        user_name: created?.user_name || user.full_name || user.email || null,
        category: normalizeCateringNoteCategory(created?.category || category),
        content: String(created?.content || noteText).trim(),
        schedule_item_id:
          created?.schedule_item_id != null && String(created.schedule_item_id).trim() !== ''
            ? Number(created.schedule_item_id)
            : modalItem.id,
        created_at: created?.created_at || new Date().toISOString(),
        updated_at: created?.updated_at,
      };
      setNotes((prev) => [...prev, normalized]);
      setNoteModalOpen(false);
      setModalItem(null);
      setNoteText('');
      setMobilePanel('notes');
      setNotesFilter('all');
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setSavingNote(false);
    }
  };

  const deleteNote = async (id: string) => {
    try {
      await apiClient.deleteCateringNote(id, eventId);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete note');
    }
  };

  const cueLabelForNote = (note: CateringNoteRow): string => {
    const id = noteItemId(note);
    if (id == null) return 'General';
    const item = scheduleById.get(id);
    return item ? formatCue(item) : `CUE ${id}`;
  };

  if (authLoading || !allowed) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-300 flex items-center justify-center">
        Loading…
      </div>
    );
  }

  const notesList = (
    <section className="rounded-lg border border-slate-600 bg-slate-800 overflow-hidden flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-slate-600 bg-slate-700 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-100">All F&amp;B notes</div>
          {activeId != null && activeCueNoteCount > 0 ? (
            <div className={`text-xs mt-0.5 font-medium ${timerRunning ? 'text-green-300' : 'text-blue-300'}`}>
              {activeCueNoteCount} note{activeCueNoteCount === 1 ? '' : 's'} on current{' '}
              {current ? formatCue(current) : 'cue'}
            </div>
          ) : (
            <div className="text-xs mt-0.5 text-slate-400">
              {notes.length} total · newest first
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md bg-slate-900 p-0.5 border border-slate-600">
            <button
              type="button"
              onClick={() => setNotesFilter('all')}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded ${
                notesFilter === 'all' ? 'bg-slate-500 text-white' : 'text-slate-400'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setNotesFilter('active')}
              disabled={activeId == null}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded disabled:opacity-40 ${
                notesFilter === 'active' ? 'bg-orange-700 text-white' : 'text-slate-400'
              }`}
            >
              Current cue
            </button>
          </div>
          <button
            type="button"
            onClick={() => setMobilePanel('schedule')}
            className="xl:hidden text-xs font-medium text-slate-300 hover:text-white"
          >
            ← Schedule
          </button>
        </div>
      </div>

      <ul className="divide-y divide-slate-700/80 overflow-y-auto max-h-[min(65vh,calc(100dvh-var(--app-header-height)-14rem))]">
        {sortedNotes.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-slate-500">
            {notesFilter === 'active'
              ? 'No notes linked to the current cue.'
              : 'No F&B notes yet. Use Add on a schedule row to create one.'}
          </li>
        ) : (
          sortedNotes.map((note) => {
            const linkedId = noteItemId(note);
            const isActiveCue = activeId != null && linkedId != null && linkedId === activeId;
            return (
              <li
                key={note.id}
                ref={note.id === firstActiveNoteId ? activeNoteRef : undefined}
                className={`px-4 py-4 ${
                  isActiveCue
                    ? timerRunning
                      ? 'bg-green-950/45 border-l-4 border-l-green-400'
                      : 'bg-blue-950/45 border-l-4 border-l-blue-400'
                    : 'border-l-4 border-l-transparent'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="inline-flex items-center rounded-md bg-orange-900/70 border border-orange-600/40 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-orange-100">
                      {CATERING_NOTE_CATEGORY_LABELS[normalizeCateringNoteCategory(note.category)]}
                    </span>
                    <span className="inline-flex items-center rounded-md bg-slate-900 border border-slate-600 px-2 py-0.5 text-[11px] font-semibold text-cyan-200">
                      {cueLabelForNote(note)}
                    </span>
                    {isActiveCue ? (
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wide ${
                          timerRunning ? 'text-green-300' : 'text-blue-300'
                        }`}
                      >
                        {timerRunning ? 'Live' : 'Loaded'}
                      </span>
                    ) : null}
                  </div>
                  {canEditNotes ? (
                    <button
                      type="button"
                      onClick={() => void deleteNote(note.id)}
                      className="text-xs text-slate-500 hover:text-red-300 shrink-0"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>

                <p className="text-base sm:text-lg text-slate-100 whitespace-pre-wrap leading-relaxed mb-2">
                  {note.content}
                </p>

                <div className="text-[11px] text-slate-500">
                  <span className="text-slate-400">{note.user_name || 'Unknown'}</span>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-white pt-[var(--app-header-height)]">
      <div className="mx-auto w-full max-w-[1400px] px-3 sm:px-6 py-4 space-y-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800/80 overflow-hidden">
          <div className="px-3 sm:px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              onClick={() => navigate('/catering')}
              className="text-slate-400 hover:text-white text-xs shrink-0"
            >
              ← Events
            </button>
            <h1 className="text-lg sm:text-xl font-bold truncate min-w-0 flex-1">{eventName || 'Event'}</h1>
            <span className="text-xs text-slate-400 tabular-nums hidden sm:inline">
              {now.toLocaleTimeString()}
            </span>
            <button
              type="button"
              onClick={() => void loadStatic()}
              className="px-2.5 py-1 text-xs font-semibold rounded-md border border-slate-600 bg-slate-700 text-slate-300 hover:text-white"
            >
              Refresh
            </button>
          </div>

          <div className="px-3 sm:px-4 pb-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-700/80 pt-3">
            <div className="flex flex-wrap items-baseline gap-3 sm:gap-4 min-w-0">
              <div className={`text-xl sm:text-2xl font-bold uppercase tracking-wide shrink-0 ${statusClass}`}>
                {statusLine}
              </div>
              <div className="text-xl sm:text-2xl font-semibold text-cyan-300 truncate">
                {current ? formatCue(current) : '—'}
              </div>
              {activeCueNoteCount > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setMobilePanel('notes');
                    setNotesFilter('active');
                  }}
                  className={`text-xs font-semibold rounded-full px-2.5 py-1 border ${
                    timerRunning
                      ? 'border-green-400/60 bg-green-950 text-green-200'
                      : 'border-blue-400/60 bg-blue-950 text-blue-200'
                  }`}
                >
                  {activeCueNoteCount} note{activeCueNoteCount === 1 ? '' : 's'}
                </button>
              ) : null}
            </div>
            <div
              className="text-3xl sm:text-4xl font-mono bg-slate-900 px-5 py-2.5 rounded-lg border border-slate-600 tabular-nums shrink-0"
              style={{ color: countdownColor(remainingSeconds, hasTimer) }}
            >
              {formatTime(hasTimer ? remainingSeconds : 0)}
            </div>
          </div>

          {hasTimer ? (
            <div className="mx-3 sm:mx-4 mb-3 bg-slate-700 rounded-full overflow-hidden border border-slate-600 relative h-1.5">
              <div
                className="h-full transition-all duration-300 absolute top-0 right-0"
                style={{
                  width: `${remainingPct}%`,
                  background: progressBarColor(remainingSeconds),
                }}
              />
            </div>
          ) : null}

          <div className="px-3 sm:px-4 pb-3 flex flex-wrap items-center gap-2">
            {days.length > 1 ? (
              <select
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
                className="bg-slate-700 border border-slate-600 rounded px-2.5 py-1.5 text-sm text-white"
              >
                {days.map((d) => (
                  <option key={d} value={d}>
                    Day {d}
                  </option>
                ))}
              </select>
            ) : null}
            <div className="flex rounded-lg bg-slate-900 p-0.5 border border-slate-600">
              <button
                type="button"
                onClick={() => setViewMode('plan')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md ${
                  viewMode === 'plan' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Plan
              </button>
              <button
                type="button"
                onClick={() => setViewMode('follow')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md ${
                  viewMode === 'follow' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Follow
              </button>
            </div>
            <div className="flex rounded-lg bg-slate-900 p-0.5 border border-slate-600">
              <button
                type="button"
                onClick={() => setFilterBreaks(false)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md ${
                  !filterBreaks ? 'bg-slate-500 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                All rows
              </button>
              <button
                type="button"
                onClick={() => setFilterBreaks(true)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md ${
                  filterBreaks ? 'bg-pink-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Breaks / F&amp;B
              </button>
            </div>
            {!canEditNotes ? <span className="text-[11px] text-slate-500">View only</span> : null}
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-red-200 text-sm">
            {error}
          </div>
        ) : null}

        <div className="xl:hidden">
          <div className="flex rounded-lg bg-slate-800 p-1 border border-slate-600">
            <button
              type="button"
              onClick={() => setMobilePanel('schedule')}
              className={`flex-1 px-3 py-2.5 text-sm font-semibold rounded-md ${
                mobilePanel === 'schedule' ? 'bg-slate-500 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Schedule
            </button>
            <button
              type="button"
              onClick={() => setMobilePanel('notes')}
              className={`flex-1 px-3 py-2.5 text-sm font-semibold rounded-md ${
                mobilePanel === 'notes' ? 'bg-orange-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              All notes
              {notes.length > 0 ? (
                <span className="ml-1.5 inline-flex min-w-[1.25rem] justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold bg-slate-900/50">
                  {notes.length}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)] gap-4 sm:gap-6 items-start">
          <section className={`min-w-0 ${mobilePanel === 'schedule' ? 'block' : 'hidden'} xl:block`}>
            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {loading ? (
                <p className="px-2 py-6 text-sm text-slate-500">Loading…</p>
              ) : dayRows.length === 0 ? (
                <p className="px-2 py-6 text-sm text-slate-500 text-center">No rows for this filter.</p>
              ) : (
                dayRows.map(({ item, index }) => {
                  const active = activeId != null && item.id === activeId;
                  const count = noteCountByItem.get(item.id) || 0;
                  const dimmed = isCueDimmed(item.id);
                  const isDelay = item.programType === 'Delay Block';

                  if (isDelay) {
                    return (
                      <div
                        key={item.id}
                        data-catering-row={item.id}
                        className={`rounded-sm overflow-hidden border-2 border-violet-400/70 ${
                          active
                            ? timerRunning
                              ? 'ring-2 ring-green-400'
                              : 'ring-2 ring-blue-400'
                            : ''
                        }`}
                        style={{ ...DELAY_ROW_BG, ...completedDimStyle(dimmed) }}
                      >
                        <div className="p-3 flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-bold text-violet-100">
                              {formatCue(item) === '—' ? 'DELAY' : formatCue(item)}
                            </div>
                            <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold text-white border border-violet-300/50 bg-violet-700">
                              Delay Block
                            </span>
                          </div>
                          <div className="rounded-md border border-violet-300/70 bg-violet-900/70 px-3 py-2 text-center text-xs font-bold tracking-wide text-violet-50">
                            ⏱ SEGMENT DELAY · {formatDuration(item)} · ALL FOLLOWING START TIMES SHIFTED
                          </div>
                          <div className="text-center text-[11px] text-violet-200/80 tabular-nums">
                            {baseStart(schedule, index) || '—'}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      data-catering-row={item.id}
                      className={`rounded-sm p-3 ${rowHighlight(active, timerRunning)}`}
                      style={completedDimStyle(dimmed)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 mb-1">
                            <span className="font-semibold text-cyan-200">{formatCue(item)}</span>
                            <span className="tabular-nums">{baseStart(schedule, index) || '—'}</span>
                            <span className="tabular-nums">{formatDuration(item)}</span>
                            {count > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-orange-900/70 border border-orange-500/50 px-1.5 py-0.5 text-[10px] font-bold text-orange-100">
                                📝 {count}
                              </span>
                            ) : null}
                            {dimmed ? (
                              <span className="text-[10px] uppercase font-semibold text-slate-500">Done</span>
                            ) : null}
                          </div>
                          <div className="font-medium text-white text-sm leading-snug">
                            {item.segmentName || '—'}
                          </div>
                          {item.programType ? (
                            <span
                              className="mt-1.5 inline-flex px-2 py-0.5 rounded text-[10px] font-semibold text-white"
                              style={{ backgroundColor: TYPE_COLOR[item.programType] || '#475569' }}
                            >
                              {item.programType}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-col gap-1.5 shrink-0">
                          {count > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setMobilePanel('notes');
                                setNotesFilter(active ? 'active' : 'all');
                              }}
                              className="text-[11px] px-2 py-1 rounded bg-slate-700 text-orange-200"
                            >
                              View
                            </button>
                          ) : null}
                          {canEditNotes ? (
                            <button
                              type="button"
                              onClick={() => openNoteModal(item)}
                              className="text-[11px] px-2 py-1 rounded bg-orange-800/80 hover:bg-orange-700 text-white"
                            >
                              Add
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop / tablet: real table so columns line up */}
            <div className="hidden md:block overflow-hidden border border-slate-600 bg-slate-800 rounded-lg">
              <div className="overflow-x-auto max-h-[70vh]">
                <table className="w-full table-fixed border-collapse text-sm">
                  <colgroup>
                    <col className="w-[7%]" />
                    <col className="w-[11%]" />
                    <col className="w-[8%]" />
                    <col className="w-[16%]" />
                    <col className="w-[38%]" />
                    <col className="w-[10%]" />
                    <col className="w-[10%]" />
                  </colgroup>
                  <thead className="bg-slate-700 sticky top-0 z-10">
                    <tr className="text-center text-xs sm:text-sm font-bold text-slate-200">
                      <th className="border-b border-r border-slate-600 px-2 py-2.5">CUE</th>
                      <th className="border-b border-r border-slate-600 px-2 py-2.5">START</th>
                      <th className="border-b border-r border-slate-600 px-2 py-2.5">DUR</th>
                      <th className="border-b border-r border-slate-600 px-2 py-2.5">TYPE</th>
                      <th className="border-b border-r border-slate-600 px-2 py-2.5 text-left">SEGMENT</th>
                      <th className="border-b border-r border-slate-600 px-2 py-2.5">NOTES</th>
                      <th className="border-b border-slate-600 px-2 py-2.5">{canEditNotes ? 'ADD' : ''}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-slate-500 text-center">
                          Loading…
                        </td>
                      </tr>
                    ) : dayRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-slate-500 text-center">
                          No rows for this filter.
                        </td>
                      </tr>
                    ) : (
                      dayRows.map(({ item, index }) => {
                        const active = activeId != null && item.id === activeId;
                        const count = noteCountByItem.get(item.id) || 0;
                        const dimmed = isCueDimmed(item.id);
                        const indentedRow = item.isIndented || isIndentedScheduleItem(item, indented);
                        const isDelay = item.programType === 'Delay Block';

                        if (isDelay) {
                          return (
                            <tr
                              key={item.id}
                              data-catering-row={item.id}
                              className={`border-b border-violet-500/40 ${
                                active
                                  ? timerRunning
                                    ? 'outline outline-2 outline-green-400 -outline-offset-2'
                                    : 'outline outline-2 outline-blue-400 -outline-offset-2'
                                  : ''
                              }`}
                              style={{ ...DELAY_ROW_BG, ...completedDimStyle(dimmed) }}
                            >
                              <td className="border-r border-violet-400/40 px-2 py-2.5 text-center align-middle">
                                <div className="text-sm font-bold text-violet-100">
                                  {formatCue(item) === '—' ? 'DELAY' : formatCue(item)}
                                </div>
                                <div className="mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold text-white border border-violet-300/50 bg-violet-700">
                                  Delay Block
                                </div>
                              </td>
                              <td colSpan={6} className="px-3 py-2.5 text-center align-middle">
                                <div className="w-full rounded-md border border-violet-300/70 bg-violet-900/70 px-3 py-2 text-sm font-bold tracking-wide text-violet-50">
                                  ⏱ SEGMENT DELAY · {formatDuration(item)} · START{' '}
                                  {baseStart(schedule, index) || '—'} · ALL FOLLOWING START TIMES SHIFTED
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        return (
                          <tr
                            key={item.id}
                            data-catering-row={item.id}
                            className={`border-b border-slate-700/80 ${
                              active
                                ? timerRunning
                                  ? 'bg-green-950'
                                  : 'bg-blue-950'
                                : 'bg-slate-900 hover:bg-slate-800/80'
                            } ${active ? (timerRunning ? 'outline outline-2 outline-green-400 -outline-offset-2' : 'outline outline-2 outline-blue-400 -outline-offset-2') : ''}`}
                            style={completedDimStyle(dimmed)}
                          >
                            <td className="border-r border-slate-700/60 px-2 py-2.5 text-center font-semibold text-cyan-200 tabular-nums align-middle">
                              {formatCue(item)}
                            </td>
                            <td className="border-r border-slate-700/60 px-2 py-2.5 text-center text-slate-200 tabular-nums align-middle">
                              {baseStart(schedule, index) || '—'}
                            </td>
                            <td className="border-r border-slate-700/60 px-2 py-2.5 text-center text-slate-300 tabular-nums align-middle">
                              {formatDuration(item)}
                            </td>
                            <td className="border-r border-slate-700/60 px-2 py-2 text-center align-middle">
                              {item.programType ? (
                                <span
                                  className="inline-flex max-w-full truncate px-2 py-0.5 rounded text-[11px] font-semibold text-white"
                                  style={{ backgroundColor: TYPE_COLOR[item.programType] || '#475569' }}
                                  title={item.programType}
                                >
                                  {item.programType}
                                </span>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                            <td
                              className={`border-r border-slate-700/60 px-2 py-2.5 text-left align-middle ${
                                indentedRow ? 'pl-6' : ''
                              }`}
                            >
                              <div className="font-medium text-white leading-snug">
                                {item.segmentName || '—'}
                              </div>
                              {active ? (
                                <div
                                  className={`text-[10px] font-bold uppercase mt-0.5 ${
                                    timerRunning ? 'text-green-300' : 'text-blue-300'
                                  }`}
                                >
                                  {timerRunning ? 'Live' : 'Loaded'}
                                  {count > 0 ? ` · ${count} note${count === 1 ? '' : 's'}` : ''}
                                </div>
                              ) : dimmed ? (
                                <div className="text-[10px] font-semibold uppercase mt-0.5 text-slate-500">
                                  Completed
                                </div>
                              ) : null}
                            </td>
                            <td className="border-r border-slate-700/60 px-2 py-2 text-center align-middle">
                              {count > 0 ? (
                                <button
                                  type="button"
                                  title="View notes for this cue"
                                  onClick={() => {
                                    setMobilePanel('notes');
                                    setNotesFilter(active ? 'active' : 'all');
                                  }}
                                  className="inline-flex items-center justify-center gap-1 min-w-[2.25rem] rounded-full bg-orange-900/80 border border-orange-500/50 px-2 py-1 text-xs font-bold text-orange-100 hover:bg-orange-800"
                                >
                                  📝 {count}
                                </button>
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-center align-middle">
                              {canEditNotes ? (
                                <button
                                  type="button"
                                  onClick={() => openNoteModal(item)}
                                  className="text-[11px] px-2.5 py-1 rounded bg-orange-800/80 hover:bg-orange-700 text-white font-semibold"
                                >
                                  Add
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <div className={`${mobilePanel === 'notes' ? 'block' : 'hidden'} xl:block`}>
            {notesList}
          </div>
        </div>
      </div>

      {/* Add note modal */}
      {noteModalOpen && modalItem ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 py-8">
          <div
            className="w-full max-w-lg rounded-xl border border-slate-600 bg-slate-800 shadow-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="catering-note-modal-title"
          >
            <div className="px-4 py-3 border-b border-slate-600 bg-slate-700 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="catering-note-modal-title" className="text-base font-semibold text-white">
                  Add F&amp;B note
                </h2>
                <p className="text-xs text-slate-300 mt-1 truncate">
                  <span className="text-cyan-300 font-semibold">{formatCue(modalItem)}</span>
                  {modalItem.segmentName ? (
                    <>
                      <span className="text-slate-500"> · </span>
                      {modalItem.segmentName}
                    </>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                onClick={closeNoteModal}
                className="text-slate-400 hover:text-white text-sm shrink-0"
              >
                Close
              </button>
            </div>
            <form onSubmit={(e) => void saveNote(e)} className="px-4 py-4 space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(normalizeCateringNoteCategory(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-sm"
                >
                  {CATERING_NOTE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATERING_NOTE_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Note</label>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={5}
                  autoFocus
                  placeholder="Plating start, break timing, meal note…"
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-700 border border-slate-600 text-sm placeholder-slate-500"
                />
              </div>
              {modalError ? (
                <div className="text-sm text-red-300 bg-red-950/40 border border-red-700/50 rounded-lg px-3 py-2">
                  {modalError}
                </div>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeNoteModal}
                  disabled={savingNote}
                  className="px-3 py-2 rounded-lg text-sm bg-slate-700 hover:bg-slate-600 text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingNote || !noteText.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white"
                >
                  {savingNote ? 'Saving…' : 'Save note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default CateringEventPage;
