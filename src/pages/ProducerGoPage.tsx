import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/database';
import { apiClient, type UserEventNoteOperator } from '../services/api-client';
import { socketClient } from '../services/socket-client';
import { stripHtmlNotes } from '../lib/eventGuestLinks';
import { displaySpeakersText, ROS_PROGRAM_TYPE_COLORS } from '../lib/guestRosHelpers';
import { programTypeSurfaceStyle } from '../lib/rosProgramTypeSplit';
import { getStoredOperatorName, operatorUserId, personColumnLabel } from '../lib/pinNotesOperator';

type Row = {
  id: number;
  day?: number;
  segmentName?: string;
  programType?: string;
  shotType?: string;
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
  notes?: string;
  assets?: string;
  speakers?: string;
  speakersText?: string;
  customFields?: Record<string, unknown>;
  mittiWatch?: boolean;
  avWatch?: boolean;
};

type Watch =
  | { kind: 'field'; id: string; name: string }
  | { kind: 'custom'; id: string; name: string }
  | { kind: 'person'; id: string; name: string };

const WATCH_KEY = 'producer-go-columns';
const MAX_WATCH = 3;

const FIELD_WATCH: Watch[] = [
  { kind: 'field', id: 'notes', name: 'Notes' },
  { kind: 'field', id: 'shotType', name: 'Shot' },
  { kind: 'field', id: 'speakers', name: 'Speakers' },
  { kind: 'field', id: 'assets', name: 'Assets' },
];

function watchKey(watch: Watch): string {
  return `${watch.kind}:${watch.id}`;
}

function loadWatchKeys(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(WATCH_KEY) || '');
    if (Array.isArray(raw) && raw.every((item) => typeof item === 'string') && raw.length > 0) {
      return raw.slice(0, MAX_WATCH);
    }
  } catch {
    /* keep the default */
  }
  return ['field:notes'];
}

function itemSeconds(item: Row): number {
  return (
    (Number(item.durationHours) || 0) * 3600 +
    (Number(item.durationMinutes) || 0) * 60 +
    (Number(item.durationSeconds) || 0)
  );
}

function formatDuration(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function formatRemaining(total: number, elapsed: number): string {
  const left = total - elapsed;
  const body = formatDuration(Math.abs(left));
  return left < 0 ? `+${body}` : body;
}

function cueOf(item: Row): string {
  const cue = item.customFields?.cue;
  return cue == null ? '' : String(cue);
}

function pickActiveTimer(raw: any): any | null {
  if (!raw) return null;
  let t: any = raw;
  if (Array.isArray(raw)) {
    t = raw.find((x) => x?.is_running && x?.is_active !== false) || raw.find((x) => x?.is_active) || raw[0] || null;
  } else if (raw.activeTimer) t = raw.activeTimer;
  else if (Array.isArray(raw.timers)) t = raw.timers.find((x: any) => x?.is_running) || raw.timers[0] || null;
  else if (Array.isArray(raw.activeTimers)) t = raw.activeTimers.find((x: any) => x?.is_running) || raw.activeTimers[0] || null;
  if (!t || t.is_active === false || (t.item_id == null && t.itemId == null)) return null;
  return t;
}

function itemIdOf(timer: any): number | null {
  const id = Number(timer?.item_id ?? timer?.itemId);
  return Number.isFinite(id) ? id : null;
}

function ProgramTypeBadge({ type }: { type?: string }) {
  const label = String(type || '').trim();
  if (!label) return null;
  const surface = programTypeSurfaceStyle(label, ROS_PROGRAM_TYPE_COLORS, '#64748B');
  const hex = String(surface.backgroundColor || '#64748B').replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const text =
    Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && (r * 299 + g * 587 + b * 114) / 1000 > 160
      ? '#0f172a'
      : '#ffffff';
  return (
    <span
      className="inline-flex max-w-[14rem] truncate rounded-md border border-white/15 px-2 py-0.5 text-xs font-semibold leading-none"
      style={{ ...surface, color: text }}
      title={label}
    >
      {label}
    </span>
  );
}

function fieldText(item: Row, id: string): string {
  switch (id) {
    case 'notes':
      return stripHtmlNotes(item.notes || '');
    case 'shotType':
      return item.shotType || '';
    case 'speakers':
      return (
        displaySpeakersText(item.speakersText || '') ||
        displaySpeakersText(typeof item.speakers === 'string' ? item.speakers : '')
      );
    case 'assets':
      return stripHtmlNotes(item.assets || '');
    default:
      return '';
  }
}

const ProducerGoPage: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();
  const eventId = new URLSearchParams(location.search).get('eventId') || '';
  const eventName = new URLSearchParams(location.search).get('eventName') || 'Producer Go';

  const [schedule, setSchedule] = useState<Row[]>([]);
  const [customColumns, setCustomColumns] = useState<{ id: string; name: string }[]>([]);
  const [operators, setOperators] = useState<UserEventNoteOperator[]>([]);
  const [peopleNotes, setPeopleNotes] = useState<Record<string, Record<number, string>>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [watchKeys, setWatchKeys] = useState<string[]>(loadWatchKeys);
  const [day, setDay] = useState(1);
  const [timer, setTimer] = useState<any | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const going = useRef(false);
  const focusedNote = useRef(false);

  const operatorId = useMemo(() => {
    const name = getStoredOperatorName();
    if (name) return operatorUserId(name);
    return user?.id ? String(user.id) : '';
  }, [user?.id]);

  const days = useMemo(() => {
    const set = new Set<number>();
    schedule.forEach((row) => set.add(row.day || 1));
    return Array.from(set).sort((a, b) => a - b);
  }, [schedule]);

  const dayRows = useMemo(() => schedule.filter((row) => (row.day || 1) === day), [schedule, day]);

  const runningId = timer?.is_running ? itemIdOf(timer) : null;
  const loadedId = !runningId && (timer?.timer_state === 'loaded' || timer?.is_active) ? itemIdOf(timer) : null;

  const current = useMemo(
    () => (runningId != null ? dayRows.find((row) => row.id === runningId) || schedule.find((row) => row.id === runningId) || null : null),
    [dayRows, schedule, runningId]
  );

  const next = useMemo(() => {
    if (runningId != null) {
      const list = current && (current.day || 1) === day ? dayRows : schedule;
      const idx = list.findIndex((row) => row.id === runningId);
      for (let i = idx + 1; i < list.length; i += 1) {
        if (itemSeconds(list[i]) > 0) return list[i];
      }
      return null;
    }
    if (loadedId != null) {
      const loaded = dayRows.find((row) => row.id === loadedId);
      if (loaded && itemSeconds(loaded) > 0) return loaded;
    }
    return dayRows.find((row) => itemSeconds(row) > 0) || null;
  }, [runningId, loadedId, current, day, dayRows, schedule]);

  const catalog = useMemo(() => {
    const people: Watch[] = operators.map((op) => ({
      kind: 'person' as const,
      id: op.user_id,
      name: personColumnLabel(op.user_name?.trim() || op.user_id.replace(/^operator:/, '').replace(/-/g, ' ')),
    }));
    if (operatorId && !people.some((person) => person.id === operatorId)) {
      const mine = getStoredOperatorName();
      people.unshift({
        kind: 'person',
        id: operatorId,
        name: mine ? personColumnLabel(mine) : 'My notes',
      });
    }
    return [
      ...FIELD_WATCH,
      ...customColumns.map((col) => ({ kind: 'custom' as const, id: col.id, name: col.name })),
      ...people,
    ];
  }, [customColumns, operators, operatorId]);

  const selected = useMemo(
    () => watchKeys.map((key) => catalog.find((watch) => watchKey(watch) === key)).filter(Boolean) as Watch[],
    [watchKeys, catalog]
  );

  const textSize = selected.length <= 1 ? 'text-2xl leading-snug' : selected.length === 2 ? 'text-xl leading-snug' : 'text-lg leading-snug';

  const loadSchedule = useCallback(async () => {
    if (!eventId) {
      setError('Missing event.');
      setLoading(false);
      return;
    }
    try {
      const data = await DatabaseService.getRunOfShowData(eventId);
      setSchedule(Array.isArray(data?.schedule_items) ? data.schedule_items : []);
      setCustomColumns(
        Array.isArray(data?.custom_columns)
          ? data.custom_columns.map((col: { id?: string; name?: string }) => ({
              id: String(col.id),
              name: String(col.name || col.id),
            }))
          : []
      );
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the rundown.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  const loadOperators = useCallback(async () => {
    if (!eventId) return;
    try {
      const res = await apiClient.listUserEventNoteOperators(eventId);
      setOperators(res.operators || []);
    } catch {
      setOperators([]);
    }
  }, [eventId]);

  const loadPerson = useCallback(
    async (userId: string) => {
      if (!eventId || !userId) return;
      try {
        const res = await apiClient.getUserEventNotes(eventId, userId);
        const map: Record<number, string> = {};
        for (const row of res.notes || []) {
          if ((row.column_key || 'personal') !== 'personal') continue;
          map[Number(row.schedule_item_id)] = String(row.content || '');
        }
        setPeopleNotes((prev) => ({ ...prev, [userId]: map }));
      } catch {
        setPeopleNotes((prev) => ({ ...prev, [userId]: {} }));
      }
    },
    [eventId]
  );

  const applyTimer = useCallback((raw: any) => {
    setTimer(pickActiveTimer(raw));
  }, []);

  useEffect(() => {
    void loadSchedule();
    void loadOperators();
  }, [loadSchedule, loadOperators]);

  useEffect(() => {
    const people = selected.filter((watch) => watch.kind === 'person').map((watch) => watch.id);
    people.forEach((id) => {
      if (!peopleNotes[id]) void loadPerson(id);
    });
  }, [selected, peopleNotes, loadPerson]);

  useEffect(() => {
    try {
      localStorage.setItem(WATCH_KEY, JSON.stringify(watchKeys));
    } catch {
      /* ignore */
    }
  }, [watchKeys]);

  useEffect(() => {
    if (!eventId) return undefined;
    void DatabaseService.getActiveTimer(eventId)
      .then((row) => applyTimer(row))
      .catch(() => undefined);
    socketClient.connect(
      eventId,
      {
        onInitialSync: async () => {
          const row = await DatabaseService.getActiveTimer(eventId);
          applyTimer(row);
        },
        onTimerUpdated: (data: any) => applyTimer(data),
        onTimerStarted: (data: any) => applyTimer({ ...data, is_running: true, is_active: true }),
        onTimerStopped: () => {
          void DatabaseService.getActiveTimer(eventId).then(applyTimer).catch(() => setTimer(null));
        },
        onTimersStopped: () => setTimer(null),
        onActiveTimersUpdated: (data: any) => applyTimer(data),
        onRunOfShowDataUpdated: () => {
          void loadSchedule();
          void loadOperators();
        },
        onServerTime: (data: any) => {
          const serverMs = data?.serverTime ? new Date(data.serverTime).getTime() : NaN;
          if (Number.isFinite(serverMs)) setClockOffset(serverMs - Date.now());
        },
      } as any,
      'producer-go'
    );
    return () => {
      try {
        socketClient.disconnect(eventId, 'producer-go');
      } catch {
        /* already closed */
      }
    };
  }, [eventId, applyTimer, loadSchedule, loadOperators]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);

  const remaining = useMemo(() => {
    const total = current ? Number(timer?.duration_seconds) || itemSeconds(current) : 0;
    if (!current || !timer?.started_at) {
      return { label: current ? formatDuration(total) : '—:—', overtime: false, pct: current ? 100 : 0 };
    }
    const startMs = new Date(timer.started_at).getTime();
    if (!Number.isFinite(startMs)) {
      return { label: formatDuration(total), overtime: false, pct: 100 };
    }
    const elapsed = Math.floor((Date.now() + clockOffset - startMs) / 1000);
    const left = total - elapsed;
    return {
      label: formatRemaining(total, elapsed),
      overtime: left < 0,
      pct: total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0,
    };
  }, [current, timer, clockOffset, tick]);

  const go = useCallback(async () => {
    if (!eventId || !user?.id || !next || going.current) return;
    going.current = true;
    setStatus('');
    setError('');
    try {
      if (runningId != null) {
        await DatabaseService.stopTimer(eventId, runningId, user.id, user.full_name, user.role);
      }
      const total = itemSeconds(next);
      const started = new Date(Date.now() + clockOffset);
      const ok = await DatabaseService.startTimer(
        eventId,
        next.id,
        user.id,
        total,
        started,
        undefined,
        cueOf(next) || undefined
      );
      if (!ok) setError('Go did not start the timer.');
      else setStatus(`Started ${next.segmentName || 'cue'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Go failed.');
    } finally {
      going.current = false;
    }
  }, [eventId, user, next, runningId, clockOffset]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      if (focusedNote.current) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      e.preventDefault();
      void go();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const saveNote = async (itemId: number) => {
    if (!eventId || !operatorId) return;
    const content = drafts[itemId] ?? peopleNotes[operatorId]?.[itemId] ?? '';
    try {
      await apiClient.saveUserEventNote({
        event_id: eventId,
        user_id: operatorId,
        user_name: getStoredOperatorName() || user?.full_name || '',
        schedule_item_id: itemId,
        column_key: 'personal',
        content,
      });
      setPeopleNotes((prev) => ({
        ...prev,
        [operatorId]: { ...(prev[operatorId] || {}), [itemId]: content },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the note.');
    }
  };

  const arm = async (item: Row, kind: 'mitti' | 'av') => {
    if (!eventId) return;
    const enabled = kind === 'mitti' ? !item.mittiWatch : !item.avWatch;
    setSchedule((rows) =>
      rows.map((row) =>
        row.id === item.id ? { ...row, ...(kind === 'mitti' ? { mittiWatch: enabled } : { avWatch: enabled }) } : row
      )
    );
    try {
      if (kind === 'mitti') await apiClient.setMittiWatch(eventId, item.id, enabled);
      else await apiClient.setAvWatch(eventId, item.id, enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not arm the video.');
      void loadSchedule();
    }
  };

  const toggleWatch = (watch: Watch) => {
    const key = watchKey(watch);
    setWatchKeys((prev) => {
      if (prev.includes(key)) return prev.filter((item) => item !== key);
      if (prev.length >= MAX_WATCH) return prev;
      return [...prev, key];
    });
  };

  const readWatch = (item: Row | null, watch: Watch): string => {
    if (!item) return '';
    if (watch.kind === 'field') return fieldText(item, watch.id);
    if (watch.kind === 'custom') {
      const raw = item.customFields?.[watch.id] ?? item.customFields?.[watch.name];
      return raw == null ? '' : stripHtmlNotes(String(raw)).trim();
    }
    return drafts[item.id] != null && watch.id === operatorId
      ? drafts[item.id]
      : peopleNotes[watch.id]?.[item.id] || '';
  };

  const noteBody = (item: Row | null, watch: Watch) => {
    const value = readWatch(item, watch);
    const mine = watch.kind === 'person' && watch.id === operatorId && item;
    if (mine) {
      return (
        <textarea
          value={drafts[item.id] ?? peopleNotes[operatorId]?.[item.id] ?? ''}
          onFocus={() => {
            focusedNote.current = true;
          }}
          onBlur={() => {
            focusedNote.current = false;
            void saveNote(item.id);
          }}
          onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
          className={`min-h-[8rem] w-full flex-1 resize-none bg-transparent font-normal text-slate-100 outline-none placeholder:text-slate-600 ${textSize}`}
          placeholder="Write a note for this cue."
        />
      );
    }
    return (
      <div className={`whitespace-pre-wrap break-words text-slate-100 ${textSize}`}>
        {value || <span className="text-slate-600">—</span>}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-slate-800 px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">Producer Go</div>
          <div className="truncate text-xs text-slate-500">{eventName}</div>
        </div>
        <div className="flex items-center gap-1.5">
          {days.length > 1
            ? days.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDay(n)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${day === n ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                >
                  Day {n}
                </button>
              ))
            : null}
        </div>
        <span className={`ml-auto truncate text-xs ${error ? 'text-red-300' : 'text-slate-500'}`}>{error || status}</span>
      </header>

      <div className="flex-shrink-0 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-5">
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400/90">
              {current ? (remaining.overtime ? 'Overtime' : 'On now') : 'Standby'}
            </div>
            {current ? (
              <div className="mb-1 flex items-center gap-1.5">
                <span className="inline-flex items-baseline gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs">
                  <span className="font-semibold text-slate-500">CUE</span>
                  <span className="font-mono font-bold text-white">{cueOf(current) || '—'}</span>
                </span>
                <ProgramTypeBadge type={current.programType} />
              </div>
            ) : null}
            <h1 className="truncate text-2xl font-semibold tracking-tight text-white">
              {current?.segmentName || 'Nothing is running'}
            </h1>
          </div>
          <div className={`font-mono text-5xl font-semibold tabular-nums leading-none ${remaining.overtime ? 'text-red-400' : 'text-white'}`}>
            {remaining.label}
          </div>
          <button
            type="button"
            disabled={!next || !user}
            onClick={() => void go()}
            className="rounded-full bg-emerald-500 px-8 py-3 text-lg font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Go
          </button>
        </div>
        <div className="relative mt-3 h-1 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className={`absolute right-0 top-0 h-full ${remaining.overtime ? 'bg-red-500' : 'bg-emerald-500'}`}
            style={{ width: `${remaining.pct}%` }}
          />
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-800 px-4 py-2">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Show</span>
        {catalog.map((watch, index) => {
          const on = watchKeys.includes(watchKey(watch));
          const blocked = !on && watchKeys.length >= MAX_WATCH;
          const previous = catalog[index - 1];
          const breakBefore = previous && previous.kind !== watch.kind;
          return (
            <React.Fragment key={watchKey(watch)}>
              {breakBefore ? <span className="mx-1 h-4 w-px shrink-0 bg-slate-700" /> : null}
              <button
                type="button"
                disabled={blocked}
                onClick={() => toggleWatch(watch)}
                title={blocked ? `Pick up to ${MAX_WATCH}` : watch.name}
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                  on
                    ? 'bg-slate-100 text-slate-950'
                    : 'bg-slate-900 text-slate-400 ring-1 ring-slate-700 disabled:opacity-30'
                }`}
              >
                {watch.name}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-slate-500">Loading the rundown…</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="px-6 pt-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Now</div>
            <div className="min-h-0 flex-1 space-y-6 overflow-auto px-6 py-4">
              {selected.length === 0 ? (
                <p className="text-sm text-slate-500">Choose Notes, a custom column, or a person above.</p>
              ) : (
                selected.map((watch) => (
                  <div key={watchKey(watch)}>
                    {selected.length > 1 ? (
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{watch.name}</div>
                    ) : null}
                    {noteBody(current, watch)}
                  </div>
                ))
              )}
            </div>
          </section>

          <div className="w-px bg-slate-800" />

          <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-slate-900/40">
            <div className="flex items-start justify-between gap-3 px-6 pt-4">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-400/90">Next</div>
                {next ? (
                  <>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="font-mono text-xs text-slate-400">{cueOf(next) ? `CUE ${cueOf(next)}` : 'No cue'}</span>
                      <ProgramTypeBadge type={next.programType} />
                      <span className="font-mono text-xs text-slate-400">{formatDuration(itemSeconds(next))}</span>
                    </div>
                    <h2 className="mt-1 truncate text-lg font-semibold text-white">{next.segmentName || 'Untitled'}</h2>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">No next cue with a duration.</p>
                )}
              </div>
              {next ? (
                <div className="flex shrink-0 gap-1.5 pt-4">
                  <button
                    type="button"
                    onClick={() => void arm(next, 'mitti')}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${next.mittiWatch ? 'bg-amber-400 text-slate-950' : 'text-slate-300 ring-1 ring-slate-600'}`}
                  >
                    {next.mittiWatch ? 'Mitti on' : 'Mitti'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void arm(next, 'av')}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${next.avWatch ? 'bg-sky-400 text-slate-950' : 'text-slate-300 ring-1 ring-slate-600'}`}
                  >
                    {next.avWatch ? 'AV on' : 'AV'}
                  </button>
                </div>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 space-y-6 overflow-auto px-6 py-4">
              {next
                ? selected.map((watch) => (
                    <div key={watchKey(watch)}>
                      {selected.length > 1 ? (
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{watch.name}</div>
                      ) : null}
                      {noteBody(next, watch)}
                    </div>
                  ))
                : null}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default ProducerGoPage;
