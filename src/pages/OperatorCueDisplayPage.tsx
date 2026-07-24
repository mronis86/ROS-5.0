import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DatabaseService } from '../services/database';
import { apiClient, getApiBaseUrl } from '../services/api-client';
import { apiAuthFetch } from '../lib/sessionAuth';
import { socketClient } from '../services/socket-client';
import {
  findParentScheduleIndex,
  isIndentedScheduleItem,
} from '../lib/scheduleStartTime';
import { Event } from '../types/Event';
import { EventSelectorDropdown } from '../components/EventSelectorDropdown';

type ScheduleItem = {
  id: number;
  day?: number;
  programType?: string;
  shotType?: string;
  segmentName?: string;
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
  duration_seconds?: number;
  notes?: string;
  assets?: string;
  speakersText?: string;
  customFields?: { cue?: string; [key: string]: unknown };
  hasPPT?: boolean;
  hasQA?: boolean;
  isPublic?: boolean;
  isStartCue?: boolean;
  isIndented?: boolean;
};

type CustomColumn = { id: string; name: string };

type FieldId =
  | 'cue'
  | 'programType'
  | 'segmentName'
  | 'shotType'
  | 'duration'
  | 'start'
  | 'pptQa'
  | 'speakers'
  | 'notes'
  | 'assets'
  | 'public'
  | `custom:${string}`;

const CORE_FIELDS: { id: FieldId; label: string; locked?: boolean }[] = [
  { id: 'cue', label: 'Cue', locked: true },
  { id: 'programType', label: 'Program Type' },
  { id: 'segmentName', label: 'Segment Name' },
  { id: 'shotType', label: 'Shot Type' },
  { id: 'duration', label: 'Duration' },
  { id: 'start', label: 'Start (incl. OT / was)' },
  { id: 'pptQa', label: 'PPT / Q&A' },
  { id: 'speakers', label: 'Speakers' },
  { id: 'notes', label: 'Notes' },
  { id: 'assets', label: 'Assets' },
  { id: 'public', label: 'Public' },
];

const DEFAULT_VISIBLE: FieldId[] = [
  'cue',
  'programType',
  'segmentName',
  'shotType',
  'duration',
  'start',
  'pptQa',
  'speakers',
  'notes',
];

const FIELDS_STORAGE_KEY = 'ros-operator-cue-display-fields-v2';

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
};

function loadVisibleFields(): Set<FieldId> {
  try {
    const raw =
      localStorage.getItem(FIELDS_STORAGE_KEY) ||
      localStorage.getItem('ros-operator-cue-display-fields-v1');
    if (!raw) return new Set(DEFAULT_VISIBLE);
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr.length) return new Set(DEFAULT_VISIBLE);
    const set = new Set(
      (arr as string[]).filter((id) => id !== 'ot') as FieldId[]
    );
    set.add('cue');
    return set;
  } catch {
    return new Set(DEFAULT_VISIBLE);
  }
}

function saveVisibleFields(set: Set<FieldId>) {
  try {
    localStorage.setItem(FIELDS_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

const cueLabel = (item?: ScheduleItem | null, fallbackId?: number | string) => {
  const c = item?.customFields?.cue;
  if (c != null && c !== '') {
    const s = String(c);
    return s.toUpperCase().startsWith('CUE') ? s : `CUE ${s}`;
  }
  if (item) return `CUE ${item.id}`;
  if (fallbackId != null) return `CUE ${fallbackId}`;
  return 'CUE';
};

const durLabel = (item: ScheduleItem) => {
  const t =
    typeof item.duration_seconds === 'number'
      ? item.duration_seconds
      : (item.durationHours || 0) * 3600 + (item.durationMinutes || 0) * 60 + (item.durationSeconds || 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const clock = (sec: number) => {
  if (!Number.isFinite(sec)) return '00:00:00';
  const n = sec < 0;
  const a = Math.abs(Math.floor(sec));
  return `${n ? '-' : ''}${String(Math.floor(a / 3600)).padStart(2, '0')}:${String(
    Math.floor((a % 3600) / 60)
  ).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};

const otLabel = (mins: number) => {
  const a = Math.abs(mins);
  const body = a >= 60 ? `${Math.floor(a / 60)}h ${a % 60}m` : `${a}m`;
  if (mins > 0) return `+${body}`;
  if (mins < 0) return `-${body}`;
  return '0m';
};

const plain = (html?: string) => (html ? html.replace(/<[^>]*>/g, '').trim() : '');

const speakers = (item?: ScheduleItem | null, max = 8) => {
  if (!item?.speakersText) return '—';
  try {
    const arr = JSON.parse(item.speakersText);
    if (!Array.isArray(arr)) return '—';
    const names = arr.map((s: any) => s?.fullName).filter(Boolean);
    if (!names.length) return '—';
    return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} +${names.length - max}`;
  } catch {
    return '—';
  }
};

const pptQa = (item?: ScheduleItem | null) => {
  if (!item) return '—';
  const p: string[] = [];
  if (item.hasPPT) p.push('PPT');
  if (item.hasQA) p.push('Q&A');
  return p.length ? p.join('+') : '—';
};

const as12 = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
};

const countdownColor = (remaining: number) => {
  if (remaining < 0) return '#ef4444';
  if (remaining > 120) return '#10b981';
  if (remaining > 30) return '#f59e0b';
  return '#ef4444';
};

const progressColor = (remaining: number) => {
  if (remaining < 0) return '#ef4444';
  if (remaining > 120) return '#10b981';
  if (remaining > 30) return '#f59e0b';
  return '#ef4444';
};

const OperatorCueDisplayPage: React.FC = () => {
  const { search } = useLocation();
  const navigate = useNavigate();
  const q = new URLSearchParams(search);
  const eventId = q.get('eventId');

  const [event, setEvent] = useState<Event | null>(
    eventId
      ? {
          id: eventId,
          name: q.get('eventName') || 'Event',
          date: q.get('eventDate') || '',
          location: q.get('eventLocation') || '',
          numberOfDays: 1,
        }
      : null
  );
  const [day, setDay] = useState(1);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [columns, setColumns] = useState<CustomColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [offset, setOffset] = useState(0);
  const [timer, setTimer] = useState<any>(null);
  const [progress, setProgress] = useState({ elapsed: 0, total: 0 });
  const [days, setDays] = useState(1);
  const [masterStart, setMasterStart] = useState('09:00');
  const [dayStarts, setDayStarts] = useState<Record<string, string>>({});
  const [otMap, setOtMap] = useState<Record<number, number>>({});
  const [showStartOt, setShowStartOt] = useState(0);
  const [startCueId, setStartCueId] = useState<number | null>(null);
  const [indented, setIndented] = useState<Record<number, { parentId: number }>>({});
  const [visible, setVisible] = useState<Set<FieldId>>(() => loadVisibleFields());
  const [showFields, setShowFields] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [showEventSelector, setShowEventSelector] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showDisconnectNotification, setShowDisconnectNotification] = useState(false);
  const [disconnectDuration, setDisconnectDuration] = useState('');
  const [disconnectTimerState, setDisconnectTimerState] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [hasShownModalOnce, setHasShownModalOnce] = useState(false);
  const [reconnectKey, setReconnectKey] = useState(0);

  const idRef = useRef(event?.id);
  idRef.current = event?.id;
  const syncRef = useRef<(() => Promise<void>) | null>(null);
  const chromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((id: FieldId) => visible.has(id), [visible]);

  const toggleField = useCallback((id: FieldId, locked?: boolean) => {
    if (locked) return;
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      next.add('cue');
      saveVisibleFields(next);
      return next;
    });
  }, []);

  const bumpChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    chromeTimerRef.current = setTimeout(() => setChromeVisible(false), 2800);
  }, []);

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
          timezone: calEvent.schedule_data?.timezone,
          created_at: calEvent.created_at,
          updated_at: calEvent.updated_at,
        };
      });
      mapped.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      setEvents(mapped.filter((e) => e.id));
    } catch (e) {
      console.warn('OperatorCueDisplay: failed to load events', e);
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    const onFs = () => {
      setIsFullscreen(!!document.fullscreenElement);
      bumpChrome();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [bumpChrome]);

  useEffect(() => {
    bumpChrome();
    return () => {
      if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    };
  }, [bumpChrome]);

  useEffect(() => {
    if (event?.id && !hasShownModalOnce) {
      setShowDisconnectModal(true);
      setHasShownModalOnce(true);
    }
  }, [event?.id, hasShownModalOnce]);

  const handleEventSelect = useCallback(
    (selected: Event) => {
      if (event?.id) socketClient.disconnect(event.id);
      setTimer(null);
      setProgress({ elapsed: 0, total: 0 });
      setSchedule([]);
      setDay(1);
      setLoading(true);
      setError('');
      setShowEventSelector(false);
      setEvent(selected);
      navigate(
        `/operator-cue-display?eventId=${encodeURIComponent(selected.id)}&eventName=${encodeURIComponent(selected.name || '')}&eventDate=${encodeURIComponent(selected.date || '')}&eventLocation=${encodeURIComponent(selected.location || '')}`,
        { replace: true }
      );
    },
    [event?.id, navigate]
  );

  const handleDisconnectTimerConfirm = (hours: number, minutes: number) => {
    const totalMinutes = hours * 60 + minutes;
    if (totalMinutes === 0) {
      alert('Please select a time greater than 0, or use "Never Disconnect"');
      return;
    }
    if (disconnectTimerState) clearTimeout(disconnectTimerState);
    const ms = totalMinutes * 60 * 1000;
    const t = setTimeout(() => {
      let timeText = '';
      if (hours > 0) timeText += `${hours}h `;
      if (minutes > 0) timeText += `${minutes}m`;
      setDisconnectDuration(timeText.trim());
      setShowDisconnectNotification(true);
      setTimeout(() => {
        if (idRef.current) socketClient.disconnect(idRef.current);
      }, 100);
    }, ms);
    setDisconnectTimerState(t);
    setShowDisconnectModal(false);
  };

  const handleNeverDisconnect = () => {
    if (disconnectTimerState) clearTimeout(disconnectTimerState);
    setDisconnectTimerState(null);
    setShowDisconnectModal(false);
  };

  const handleReconnect = () => {
    setShowDisconnectNotification(false);
    if (event?.id) {
      setReconnectKey((k) => k + 1);
      setShowDisconnectModal(true);
    }
  };

  useEffect(() => {
    if (eventId && eventId !== event?.id) {
      setEvent({
        id: eventId,
        name: q.get('eventName') || 'Event',
        date: q.get('eventDate') || '',
        location: q.get('eventLocation') || '',
        numberOfDays: 1,
      });
    }
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

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
          secs += (it.durationHours || 0) * 3600 + (it.durationMinutes || 0) * 60 + (it.durationSeconds || 0);
        }
      }
      const [hh, mm] = start.split(':').map(Number);
      const total = hh * 3600 + mm * 60 + secs;
      return as12(Math.floor(total / 3600) % 24, Math.floor((total % 3600) / 60));
    },
    [dayStarts, indented, masterStart]
  );

  const cumOt = useCallback(
    (full: ScheduleItem[], index: number) => {
      const item = full[index];
      if (!item) return 0;
      const startIdx = startCueId != null ? full.findIndex((s) => s.id === startCueId) : -1;
      const from = startIdx >= 0 ? startIdx : 0;
      let total = 0;
      for (let i = from; i < index; i++) {
        const it = full[i];
        if ((it.day || 1) === (item.day || 1) && !isIndentedScheduleItem(it, indented)) {
          total += otMap[it.id] || 0;
        }
      }
      if (showStartOt && startCueId != null && startIdx >= 0 && index >= startIdx) total += showStartOt;
      return total;
    },
    [indented, otMap, showStartOt, startCueId]
  );

  const adjStart = useCallback(
    (full: ScheduleItem[], index: number): string => {
      const item = full[index];
      if (!item) return '';
      if (isIndentedScheduleItem(item, indented)) {
        const p = findParentScheduleIndex(full, index, indented);
        return p < 0 ? '' : adjStart(full, p);
      }
      const base = baseStart(full, index);
      if (!base) return '';
      const ot = cumOt(full, index);
      if (!ot) return base;
      const [tp, period] = base.split(' ');
      const [h, m] = tp.split(':').map(Number);
      let h24 = h;
      if (period === 'PM' && h !== 12) h24 += 12;
      if (period === 'AM' && h === 12) h24 = 0;
      const mins = h24 * 60 + m + ot;
      return as12(Math.floor(mins / 60) % 24, ((mins % 60) + 60) % 60);
    },
    [baseStart, cumOt, indented]
  );

  const reload = useCallback(async () => {
    const id = idRef.current;
    if (!id) {
      setError('No event selected');
      setLoading(false);
      return;
    }
    try {
      apiClient.invalidateSyncDataCache(id);
      const data = await DatabaseService.getRunOfShowData(id);
      if (data?.schedule_items) {
        const rows = data.schedule_items.map((item: any) => ({
          ...item,
          durationHours: Math.floor((item.duration_seconds || 0) / 3600),
          durationMinutes: Math.floor(((item.duration_seconds || 0) % 3600) / 60),
          durationSeconds: (item.duration_seconds || 0) % 60,
        }));
        setSchedule(rows);
        setDays(Math.max(1, ...rows.map((r: ScheduleItem) => r.day || 1)));
        setStartCueId(rows.find((r: ScheduleItem) => r.isStartCue)?.id ?? null);
        if (data.settings?.masterStartTime) setMasterStart(data.settings.masterStartTime);
        else if (data.settings?.dayStartTimes?.['1']) setMasterStart(data.settings.dayStartTimes['1']);
        if (data.settings?.dayStartTimes) setDayStarts(data.settings.dayStartTimes);
      }
      if (Array.isArray(data?.custom_columns)) {
        setColumns(data.custom_columns.map((c: any) => ({ id: String(c.id), name: String(c.name || c.id) })));
      }
      const [ot, showOt, ind] = await Promise.all([
        DatabaseService.getOvertimeMinutes(id),
        DatabaseService.getShowStartOvertime(id),
        DatabaseService.getIndentedCues(id),
      ]);
      setOtMap(ot || {});
      if (showOt != null) {
        setShowStartOt((showOt as any).show_start_overtime ?? (showOt as any).overtimeMinutes ?? 0);
        const sid = (showOt as any).item_id ?? (showOt as any).itemId;
        if (sid != null) setStartCueId(Number(sid));
      }
      const map: Record<number, { parentId: number }> = {};
      (ind || []).forEach((c: any) => {
        if (c.item_id && c.parent_item_id) map[c.item_id] = { parentId: c.parent_item_id };
      });
      setIndented(map);
      setError('');
    } catch (e) {
      console.error(e);
      setError('Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!event?.id) return;
    syncRef.current = reload;
    void reload();
    const iv = setInterval(() => void reload(), 20000);
    return () => {
      syncRef.current = null;
      clearInterval(iv);
    };
  }, [event?.id, reload]);

  useEffect(() => {
    if (!event?.id) return;
    let dead = false;
    const apply = (t: any) => setTimer(t?.item_id ? t : null);

    const boot = async () => {
      try {
        const res = await apiAuthFetch(`${getApiBaseUrl()}/api/active-timers/${event.id}`);
        if (!res || !res.ok || dead) return;
        const raw = await res.json();
        const t = Array.isArray(raw) ? raw[0] : raw?.value?.[0] || (raw?.item_id ? raw : null);
        if (!dead) apply(t);
      } catch (e) {
        console.error(e);
      }
    };
    void boot();

    const cb = {
      onServerTime: (d: any) => {
        if (d?.serverTime) setOffset(new Date(d.serverTime).getTime() - Date.now());
      },
      onTimerUpdated: (d: any) => apply(d),
      onTimerStarted: (d: any) => apply(d),
      onTimerStopped: () => {
        setTimer(null);
        void syncRef.current?.();
      },
      onTimersStopped: () => {
        setTimer(null);
        void syncRef.current?.();
      },
      onInitialSync: () => {
        void boot();
        void syncRef.current?.();
      },
      onConnectionChange: () => {},
    };
    socketClient.connect(event.id, cb);
    const vis = () => {
      if (document.hidden) socketClient.disconnect(event.id);
      else if (!socketClient.isConnected()) {
        socketClient.connect(event.id, cb);
        cb.onInitialSync();
      }
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      dead = true;
      document.removeEventListener('visibilitychange', vis);
      socketClient.disconnect(event.id);
    };
  }, [event?.id, reconnectKey]);

  useEffect(() => {
    const running = timer?.timer_state === 'running' || (timer?.is_running && timer?.is_active);
    if (running && timer?.started_at) {
      const start = new Date(timer.started_at).getTime();
      const total = timer.duration_seconds || 0;
      const tick = () => setProgress({ elapsed: Math.floor((Date.now() + offset - start) / 1000), total });
      tick();
      const iv = setInterval(tick, 1000);
      return () => clearInterval(iv);
    }
    if (timer) {
      setProgress({ elapsed: timer.elapsed_seconds || 0, total: timer.duration_seconds || 0 });
    } else setProgress({ elapsed: 0, total: 0 });
  }, [timer, offset]);

  const activeId = timer?.item_id != null ? Number(timer.item_id) : null;

  useEffect(() => {
    if (activeId == null) return;
    const live = schedule.find((s) => String(s.id) === String(activeId));
    if (live && (live.day || 1) !== day) setDay(live.day || 1);
  }, [activeId, schedule, day]);

  const dayRows = useMemo(() => schedule.filter((s) => (s.day || 1) === day), [schedule, day]);

  const current = useMemo(() => {
    if (activeId != null) {
      const live = schedule.find((s) => String(s.id) === String(activeId));
      if (live) return live;
    }
    return null;
  }, [activeId, schedule]);

  const nextRows = useMemo(() => {
    if (dayRows.length === 0) return [] as ScheduleItem[];
    if (!current) return dayRows.slice(0, 8);
    const i = dayRows.findIndex((s) => s.id === current.id);
    if (i < 0) return dayRows.slice(0, 8);
    return dayRows.slice(i + 1, i + 9);
  }, [dayRows, current]);

  const curIdx = current ? schedule.findIndex((s) => s.id === current.id) : -1;
  const startWas = curIdx >= 0 ? baseStart(schedule, curIdx) : '';
  const startNow = curIdx >= 0 ? adjStart(schedule, curIdx) : '';
  const otNow = curIdx >= 0 ? cumOt(schedule, curIdx) : 0;
  const rowOt = current ? otMap[current.id] || 0 : 0;
  const isStart = !!(current && startCueId != null && current.id === startCueId);

  const remaining = progress.total - progress.elapsed;
  const pct = progress.total > 0 ? Math.max(0, Math.min(100, (remaining / progress.total) * 100)) : 0;
  const running = !!(timer?.timer_state === 'running' || (timer?.is_running && timer?.is_active));
  const loaded = !!timer && !running;

  const statusTextCls = running ? 'text-green-400' : loaded ? 'text-yellow-400' : 'text-slate-300';
  const statusLine = running
    ? `RUNNING - ${cueLabel(current, activeId ?? undefined)}`
    : loaded
      ? `LOADED - ${cueLabel(current, activeId ?? undefined)}`
      : 'No CUE Selected';
  const currentBg = running ? 'bg-green-950' : loaded ? 'bg-blue-950' : 'bg-slate-900';

  const noteText = plain(current?.notes);
  const noteOk = !!noteText && !['None', 'null', 'undefined'].includes(noteText);

  const fieldOptions = useMemo(() => {
    const customOpts = columns.map((c) => ({
      id: `custom:${c.id}` as FieldId,
      label: c.name || c.id,
      locked: false,
    }));
    return [...CORE_FIELDS, ...customOpts];
  }, [columns]);

  // Next-table columns (order matters)
  const nextCols = useMemo(() => {
    const cols: { id: FieldId; label: string; fr: string }[] = [];
    if (show('cue')) cols.push({ id: 'cue', label: 'CUE', fr: '0.85fr' });
    if (show('programType')) cols.push({ id: 'programType', label: 'TYPE', fr: '1fr' });
    if (show('segmentName')) cols.push({ id: 'segmentName', label: 'SEGMENT', fr: '2.2fr' });
    if (show('duration')) cols.push({ id: 'duration', label: 'DUR', fr: '0.8fr' });
    if (show('start')) cols.push({ id: 'start', label: 'START', fr: '1.2fr' });
    if (show('pptQa')) cols.push({ id: 'pptQa', label: 'PPT/QA', fr: '0.7fr' });
    if (show('speakers')) cols.push({ id: 'speakers', label: 'SPEAKERS', fr: '1.5fr' });
    if (show('notes')) cols.push({ id: 'notes', label: 'NOTES', fr: '1.6fr' });
    columns.forEach((c) => {
      const id = `custom:${c.id}` as FieldId;
      if (show(id)) cols.push({ id, label: c.name.toUpperCase(), fr: '1.1fr' });
    });
    return cols;
  }, [show, columns]);

  const nextGrid = nextCols.map((c) => c.fr).join(' ') || '1fr';

  // Current primary cells
  const currentPrimary = useMemo(() => {
    if (!current) return [] as { id: FieldId; label: string; node: React.ReactNode }[];
    const cells: { id: FieldId; label: string; node: React.ReactNode }[] = [];
    if (show('cue')) {
      cells.push({
        id: 'cue',
        label: 'CUE',
        node: <div className="font-bold text-xl">{cueLabel(current)}</div>,
      });
    }
    if (show('programType')) {
      cells.push({
        id: 'programType',
        label: 'TYPE',
        node: current.programType ? (
          <span
            className="inline-block px-2 py-1 rounded text-xs font-semibold text-white"
            style={{ backgroundColor: TYPE_COLOR[current.programType] || '#475569' }}
          >
            {current.programType}
          </span>
        ) : (
          <span className="text-slate-500">—</span>
        ),
      });
    }
    if (show('segmentName')) {
      cells.push({
        id: 'segmentName',
        label: 'SEGMENT',
        node: (
          <div>
            <div className="font-bold text-lg truncate">{current.segmentName || 'Untitled'}</div>
            {show('shotType') && (
              <div className="text-sm text-slate-400 truncate">{current.shotType || '—'}</div>
            )}
          </div>
        ),
      });
    } else if (show('shotType')) {
      cells.push({
        id: 'shotType',
        label: 'SHOT',
        node: <div className="text-base">{current.shotType || '—'}</div>,
      });
    }
    if (show('duration')) {
      cells.push({
        id: 'duration',
        label: 'DURATION',
        node: <div className="font-mono font-bold text-lg">{durLabel(current)}</div>,
      });
    }
    if (show('start')) {
      const otBadge = isStart
        ? showStartOt > 0
          ? `${otLabel(showStartOt)} late`
          : showStartOt < 0
            ? `${otLabel(showStartOt)} early`
            : null
        : otNow !== 0
          ? otLabel(otNow)
          : null;
      cells.push({
        id: 'start',
        label: 'START',
        node: (
          <div>
            <div className="font-bold text-lg">{startNow || '—'}</div>
            {startWas && startNow && startWas !== startNow && (
              <div className="text-xs text-slate-400">was {startWas}</div>
            )}
            {otBadge && (
              <div
                className={`mt-0.5 inline-block px-1.5 py-0.5 rounded text-xs font-bold ${
                  (isStart ? showStartOt : otNow) > 0
                    ? 'bg-red-900/40 text-red-300'
                    : 'bg-emerald-900/40 text-emerald-300'
                }`}
              >
                {otBadge}
              </div>
            )}
            {rowOt !== 0 && !isStart && (
              <div className="text-xs text-slate-400 mt-0.5">row {otLabel(rowOt)}</div>
            )}
          </div>
        ),
      });
    }
    if (show('pptQa')) {
      cells.push({
        id: 'pptQa',
        label: 'PPT / Q&A',
        node: (
          <div className={`text-base ${pptQa(current) !== '—' ? 'text-sky-300 font-semibold' : 'text-slate-500'}`}>
            {pptQa(current)}
          </div>
        ),
      });
    }
    if (show('public')) {
      cells.push({
        id: 'public',
        label: 'PUBLIC',
        node: <div className="text-base">{current.isPublic ? 'Yes' : 'No'}</div>,
      });
    }
    return cells;
  }, [
    current,
    show,
    startNow,
    startWas,
    otNow,
    isStart,
    showStartOt,
    rowOt,
  ]);

  const detailPanels = useMemo(() => {
    if (!current) return [] as { id: string; title: string; body: React.ReactNode }[];
    const panels: { id: string; title: string; body: React.ReactNode }[] = [];
    if (show('speakers')) {
      panels.push({ id: 'speakers', title: 'SPEAKERS', body: speakers(current, 12) });
    }
    if (show('notes')) {
      panels.push({
        id: 'notes',
        title: 'NOTES',
        body: noteOk ? noteText : '—',
      });
    }
    if (show('assets')) {
      const a = plain(current.assets);
      panels.push({ id: 'assets', title: 'ASSETS', body: a || '—' });
    }
    columns.forEach((c) => {
      const id = `custom:${c.id}` as FieldId;
      if (!show(id)) return;
      const v = plain(String(current.customFields?.[c.id] ?? ''));
      panels.push({ id, title: c.name.toUpperCase(), body: v || '—' });
    });
    return panels;
  }, [current, show, columns, noteOk, noteText]);

  if (loading) {
    return <div className="fixed inset-0 bg-black text-white grid place-items-center text-xl">Loading…</div>;
  }
  if (error && !schedule.length) {
    return <div className="fixed inset-0 bg-black text-red-400 grid place-items-center text-xl">{error}</div>;
  }

  const renderNextCell = (item: ScheduleItem, colId: FieldId) => {
    const idx = schedule.findIndex((s) => s.id === item.id);
    const st = idx >= 0 ? adjStart(schedule, idx) : '';
    const ot = idx >= 0 ? cumOt(schedule, idx) : 0;
    if (colId === 'cue') return <span className="font-bold truncate">{cueLabel(item)}</span>;
    if (colId === 'programType') {
      return item.programType ? (
        <span
          className="inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold text-white truncate max-w-full"
          style={{ backgroundColor: TYPE_COLOR[item.programType] || '#475569' }}
        >
          {item.programType}
        </span>
      ) : (
        '—'
      );
    }
    if (colId === 'segmentName') return <span className="font-semibold truncate">{item.segmentName || '—'}</span>;
    if (colId === 'duration') return <span className="font-mono truncate">{durLabel(item)}</span>;
    if (colId === 'start') {
      return (
        <span className="truncate leading-tight">
          <span className="text-slate-200">{st || '—'}</span>
          {ot !== 0 && (
            <span className={`ml-1 ${ot > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{otLabel(ot)}</span>
          )}
        </span>
      );
    }
    if (colId === 'pptQa') {
      return (
        <span className={`truncate ${pptQa(item) !== '—' ? 'text-sky-300' : 'text-slate-500'}`}>
          {pptQa(item)}
        </span>
      );
    }
    if (colId === 'speakers') return <span className="truncate text-slate-300">{speakers(item, 3)}</span>;
    if (colId === 'notes') {
      const n = plain(item.notes);
      return <span className="truncate text-slate-400">{n || '—'}</span>;
    }
    if (colId.startsWith('custom:')) {
      const cid = colId.slice(7);
      const v = plain(String(item.customFields?.[cid] ?? ''));
      return <span className="truncate text-slate-300">{v || '—'}</span>;
    }
    return null;
  };

  return (
    <div
      className="fixed inset-0 bg-black grid place-items-center"
      onMouseMove={bumpChrome}
    >
      <div
        className="relative bg-slate-950 text-white flex flex-col overflow-hidden"
        style={{
          width: 'min(100vw, calc(100vh * 16 / 9))',
          height: 'min(100vh, calc(100vw * 9 / 16))',
        }}
      >
        {/* ROS-style chrome */}
        <div className="shrink-0 px-6 pt-3 pb-2 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="text-2xl font-bold truncate">{event?.name || 'Event'}</div>
            <div className="text-sm text-slate-400 mt-0.5 flex flex-wrap items-center gap-2">
              <span>{now.toLocaleTimeString()}</span>
              {days > 1 && (
                <select
                  value={day}
                  onChange={(e) => setDay(Number(e.target.value))}
                  className="bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-xs text-white"
                >
                  {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      Day {d}
                    </option>
                  ))}
                </select>
              )}
              {showEventSelector ? (
                <div className="flex items-center gap-2">
                  <EventSelectorDropdown
                    events={events}
                    value={event?.id ?? null}
                    onChange={handleEventSelect}
                    disabled={eventsLoading}
                    loading={eventsLoading}
                    placeholder="Select event…"
                    selectClassName="min-w-[180px] max-w-[280px]"
                    listMaxHeight="200px"
                  />
                  <button
                    type="button"
                    onClick={() => void loadEvents()}
                    className="px-2 py-0.5 rounded border border-slate-600 bg-slate-800 text-xs text-slate-200"
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEventSelector(false)}
                    className="px-2 py-0.5 rounded border border-slate-600 bg-slate-800 text-xs text-slate-200"
                  >
                    Hide
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowEventSelector(true);
                    void loadEvents();
                  }}
                  className="px-2 py-0.5 rounded border border-slate-600 bg-slate-800 text-xs text-slate-200 hover:bg-slate-700"
                >
                  Change event
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowFields((v) => !v)}
                className={`px-2 py-0.5 rounded border text-xs ${
                  showFields
                    ? 'bg-sky-700 border-sky-500 text-white'
                    : 'bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700'
                }`}
              >
                Fields
              </button>
            </div>
          </div>

          <div className="flex items-center gap-6 shrink-0">
            <div className={`text-xl font-bold ${statusTextCls}`}>{statusLine}</div>
            <div
              className="text-4xl font-mono bg-slate-800 px-6 py-3 rounded-lg border border-slate-600"
              style={{ color: countdownColor(remaining) }}
            >
              {clock(remaining)}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-6 mb-2">
          <div className="w-full h-2.5 bg-slate-700 rounded-full overflow-hidden border border-slate-600 relative">
            <div
              className="h-full absolute top-0 right-0 transition-all duration-1000"
              style={{ width: `${pct}%`, background: progressColor(remaining) }}
            />
          </div>
        </div>

        {/* Fields filter panel */}
        {showFields && (
          <div className="absolute top-16 left-6 z-40 w-[22rem] max-h-[70%] overflow-y-auto rounded-lg border border-slate-600 bg-slate-900 shadow-2xl p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-bold">Show fields</div>
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-white"
                onClick={() => setShowFields(false)}
              >
                Close
              </button>
            </div>
            <div className="space-y-1">
              {fieldOptions.map((f) => (
                <label
                  key={f.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-slate-800 ${
                    f.locked ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={visible.has(f.id)}
                    disabled={!!f.locked}
                    onChange={() => toggleField(f.id, f.locked)}
                    className="rounded border-slate-500"
                  />
                  <span>{f.label}</span>
                  {f.locked ? <span className="text-[10px] text-slate-500">required</span> : null}
                </label>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 w-full text-xs px-2 py-1.5 rounded bg-slate-800 border border-slate-600 hover:bg-slate-700"
              onClick={() => {
                const next = new Set(DEFAULT_VISIBLE);
                saveVisibleFields(next);
                setVisible(next);
              }}
            >
              Reset to defaults
            </button>
          </div>
        )}

        {/* CURRENT — larger type, still compact block */}
        <div className="shrink-0 px-4 pb-3">
          {!current ? (
            <div className="rounded border border-slate-700 bg-slate-900 px-4 py-4 text-slate-400 text-base">
              Load a cue on Run of Show to pin it here.
            </div>
          ) : (
            <div className={`rounded border border-slate-600 overflow-hidden ${currentBg}`}>
              <div
                className="grid gap-3 px-4 py-3 items-start border-b border-slate-700/50"
                style={{
                  gridTemplateColumns: `repeat(${Math.max(currentPrimary.length, 1)}, minmax(0, 1fr))`,
                }}
              >
                {currentPrimary.map((cell) => (
                  <div key={cell.id} className="min-w-0">
                    <div className="text-xs text-slate-400 font-bold mb-0.5">{cell.label}</div>
                    {cell.node}
                  </div>
                ))}
              </div>

              {detailPanels.length > 0 && (
                <div
                  className="grid gap-4 px-4 py-3 text-base"
                  style={{
                    gridTemplateColumns: `repeat(${Math.min(detailPanels.length, 3)}, minmax(0, 1fr))`,
                  }}
                >
                  {detailPanels.map((p) => (
                    <div key={p.id} className="min-w-0 max-h-36 overflow-y-auto">
                      <div className="text-xs text-slate-400 font-bold mb-1">{p.title}</div>
                      <div className="leading-snug text-slate-100 whitespace-pre-line">{p.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* NEXT */}
        <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
          <div className="text-xs font-bold tracking-widest text-slate-500 mb-1.5 shrink-0">NEXT</div>
          <div className="flex-1 min-h-0 rounded border border-slate-700 overflow-hidden flex flex-col bg-slate-900/80">
            <div
              className="shrink-0 grid gap-2 px-3 py-2 text-xs font-bold text-slate-500 border-b border-slate-700 bg-slate-900"
              style={{ gridTemplateColumns: nextGrid }}
            >
              {nextCols.map((c) => (
                <div key={c.id}>{c.label}</div>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {nextRows.length === 0 ? (
                <div className="px-3 py-4 text-base text-slate-500">End of schedule</div>
              ) : (
                nextRows.map((item, i) => {
                  const zebra = i % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900';
                  return (
                    <div
                      key={item.id}
                      className={`grid gap-2 px-3 py-2.5 text-sm items-center border-b border-slate-800 ${zebra}`}
                      style={{ gridTemplateColumns: nextGrid }}
                    >
                      {nextCols.map((c) => (
                        <div key={c.id} className="min-w-0 flex items-center">
                          {renderNextCell(item, c.id)}
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          className={`absolute bottom-2 right-3 z-20 text-xs px-2 py-1 rounded bg-slate-800/95 border border-slate-600 transition-opacity ${
            chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onClick={() => {
            if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.();
            else void document.exitFullscreen?.();
          }}
        >
          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
      </div>

      {showDisconnectModal && (
        <DisconnectTimerModal onConfirm={handleDisconnectTimerConfirm} onNever={handleNeverDisconnect} />
      )}
      {showDisconnectNotification && (
        <DisconnectNotification duration={disconnectDuration} onReconnect={handleReconnect} />
      )}
    </div>
  );
};

const DisconnectTimerModal: React.FC<{ onConfirm: (hours: number, mins: number) => void; onNever: () => void }> = ({
  onConfirm,
  onNever,
}) => {
  const [hours, setHours] = useState(2);
  const [minutes, setMinutes] = useState(0);
  const minuteValues = [0, 5, 10, 15, 20, 25, 30];
  const hoursRef = React.useRef<HTMLDivElement>(null);
  const minutesRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (hoursRef.current) hoursRef.current.scrollTop = hours * 50;
    if (minutesRef.current) minutesRef.current.scrollTop = minuteValues.indexOf(minutes) * 50;
  }, []);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[999999]">
      <div className="bg-slate-800 p-10 rounded-2xl border border-slate-700 shadow-2xl max-w-3xl w-[90%]">
        <h3 className="text-slate-100 text-3xl font-semibold mb-2 text-center">Auto-Disconnect Timer</h3>
        <p className="text-slate-400 mb-8 text-center">How long should this connection stay active?</p>
        <div className="flex items-center justify-center gap-12 mb-10 py-8">
          <div className="flex flex-col items-center gap-4">
            <div className="text-slate-300 text-sm font-medium uppercase tracking-wider">Hours</div>
            <div className="relative w-32 h-56 bg-slate-900 border border-slate-600 rounded-2xl overflow-hidden">
              <div
                ref={hoursRef}
                onScroll={() => {
                  if (!hoursRef.current) return;
                  setHours(Math.max(0, Math.min(Math.round(hoursRef.current.scrollTop / 50), 24)));
                }}
                className="h-full overflow-y-scroll pt-24 pb-24"
              >
                {Array.from({ length: 25 }, (_, i) => (
                  <div
                    key={i}
                    className={`h-12 flex items-center justify-center text-2xl ${
                      hours === i ? 'text-slate-100' : 'text-slate-600'
                    }`}
                  >
                    {i}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="text-slate-300 text-4xl font-light mt-10">:</div>
          <div className="flex flex-col items-center gap-4">
            <div className="text-slate-300 text-sm font-medium uppercase tracking-wider">Minutes</div>
            <div className="relative w-32 h-56 bg-slate-900 border border-slate-600 rounded-2xl overflow-hidden">
              <div
                ref={minutesRef}
                onScroll={() => {
                  if (!minutesRef.current) return;
                  const index = Math.round(minutesRef.current.scrollTop / 50);
                  setMinutes(minuteValues[Math.max(0, Math.min(index, minuteValues.length - 1))]);
                }}
                className="h-full overflow-y-scroll pt-24 pb-24"
              >
                {minuteValues.map((m) => (
                  <div
                    key={m}
                    className={`h-12 flex items-center justify-center text-2xl ${
                      minutes === m ? 'text-slate-100' : 'text-slate-600'
                    }`}
                  >
                    {m}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onConfirm(hours, minutes)}
            className="flex-1 px-8 py-4 bg-blue-600 hover:bg-blue-700 rounded-xl text-white text-lg font-medium"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={onNever}
            className="flex-1 px-8 py-4 bg-slate-600 hover:bg-slate-500 rounded-xl text-slate-200 text-lg font-medium"
          >
            Never Disconnect
          </button>
        </div>
        <p className="mt-6 text-sm text-slate-500 text-center">Never may increase database costs</p>
      </div>
    </div>
  );
};

const DisconnectNotification: React.FC<{ duration: string; onReconnect: () => void }> = ({
  duration,
  onReconnect,
}) => (
  <>
    <div className="fixed inset-0 bg-black bg-opacity-70 z-[999998]" />
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[999999]">
      <div className="bg-slate-800 p-10 rounded-2xl border-2 border-slate-600 shadow-2xl flex items-center gap-6 min-w-[450px]">
        <div className="text-5xl">🔌</div>
        <div className="flex-1">
          <h4 className="text-slate-100 text-2xl font-semibold mb-2">Connection Closed</h4>
          <p className="text-slate-400 text-base">Auto-disconnected after {duration}</p>
        </div>
        <button
          type="button"
          onClick={onReconnect}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl text-white text-base font-medium"
        >
          Reconnect
        </button>
      </div>
    </div>
  </>
);

export default OperatorCueDisplayPage;
