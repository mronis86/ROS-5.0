import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/database';
import { apiClient } from '../services/api-client';
import { socketClient } from '../services/socket-client';
import { stripHtmlNotes } from '../lib/eventGuestLinks';
import { displaySpeakersText, ROS_PROGRAM_TYPE_COLORS } from '../lib/guestRosHelpers';
import { programTypeSurfaceStyle } from '../lib/rosProgramTypeSplit';
import { getStoredOperatorName, operatorUserId } from '../lib/pinNotesOperator';

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

type Column = { id: string; name: string };

const BUILTIN_COLUMNS: Column[] = [
  { id: 'programType', name: 'Program Type' },
  { id: 'shotType', name: 'Shot Type' },
  { id: 'speakers', name: 'Speakers' },
  { id: 'notes', name: 'Notes' },
  { id: 'assets', name: 'Assets' },
  { id: 'mittiWatch', name: 'Mitti' },
  { id: 'avWatch', name: 'AV' },
];

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
  if (!label) return <span className="text-slate-600">—</span>;
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
      className="inline-flex max-w-full truncate rounded-md border border-white/15 px-2 py-0.5 text-xs font-semibold leading-none"
      style={{ ...surface, color: text }}
      title={label}
    >
      {label}
    </span>
  );
}

function columnText(item: Row | null, column: Column): string {
  if (!item) return '';
  switch (column.id) {
    case 'programType':
      return item.programType || '';
    case 'shotType':
      return item.shotType || '';
    case 'speakers':
      return (
        displaySpeakersText(item.speakersText || '') ||
        displaySpeakersText(typeof item.speakers === 'string' ? item.speakers : '')
      );
    case 'notes':
      return stripHtmlNotes(item.notes || '');
    case 'assets':
      return stripHtmlNotes(item.assets || '');
    case 'mittiWatch':
      return item.mittiWatch ? 'Armed' : '';
    case 'avWatch':
      return item.avWatch ? 'Armed' : '';
    default: {
      const raw = item.customFields?.[column.id] ?? item.customFields?.[column.name];
      return raw == null ? '' : stripHtmlNotes(String(raw)).trim();
    }
  }
}

const ProducerGoPage: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();
  const eventId = new URLSearchParams(location.search).get('eventId') || '';
  const eventName = new URLSearchParams(location.search).get('eventName') || 'Producer Go';

  const [schedule, setSchedule] = useState<Row[]>([]);
  const [customColumns, setCustomColumns] = useState<Column[]>([]);
  const [day, setDay] = useState(1);
  const [timer, setTimer] = useState<any | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
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
      const list = (current && (current.day || 1) === day ? dayRows : schedule);
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

  const loadNotes = useCallback(async () => {
    if (!eventId || !operatorId) return;
    try {
      const res = await apiClient.getUserEventNotes(eventId, operatorId);
      const map: Record<number, string> = {};
      for (const row of res.notes || []) {
        if ((row.column_key || 'personal') !== 'personal') continue;
        map[Number(row.schedule_item_id)] = String(row.content || '');
      }
      setNotes(map);
    } catch {
      setNotes({});
    }
  }, [eventId, operatorId]);

  const applyTimer = useCallback((raw: any) => {
    setTimer(pickActiveTimer(raw));
  }, []);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

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
  }, [eventId, applyTimer, loadSchedule]);

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

  const columns = useMemo(() => [...BUILTIN_COLUMNS, ...customColumns], [customColumns]);

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
    const content = drafts[itemId] ?? notes[itemId] ?? '';
    try {
      await apiClient.saveUserEventNote({
        event_id: eventId,
        user_id: operatorId,
        user_name: getStoredOperatorName() || user?.full_name || '',
        schedule_item_id: itemId,
        column_key: 'personal',
        content,
      });
      setNotes((prev) => ({ ...prev, [itemId]: content }));
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

  const pane = (label: string, item: Row | null, live: boolean) => {
    const note = item ? (drafts[item.id] ?? notes[item.id] ?? '') : '';
    const accent = live ? 'text-emerald-400' : 'text-sky-400';
    return (
      <section className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${live ? 'bg-emerald-950/20' : 'bg-slate-950'}`}>
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-slate-700 px-3 py-1.5">
          <h2 className={`text-sm font-semibold uppercase tracking-wide ${accent}`}>{label}</h2>
          {item ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm tabular-nums text-slate-300">
                {live ? remaining.label : formatDuration(itemSeconds(item))}
              </span>
              <button
                type="button"
                onClick={() => void arm(item, 'mitti')}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold ${item.mittiWatch ? 'bg-amber-500 text-slate-950' : 'border border-slate-600 text-slate-200'}`}
              >
                {item.mittiWatch ? 'Mitti armed' : 'Arm Mitti'}
              </button>
              <button
                type="button"
                onClick={() => void arm(item, 'av')}
                className={`rounded px-2 py-0.5 text-[11px] font-semibold ${item.avWatch ? 'bg-sky-500 text-slate-950' : 'border border-slate-600 text-slate-200'}`}
              >
                {item.avWatch ? 'AV armed' : 'Arm AV'}
              </button>
            </div>
          ) : null}
        </div>
        {item ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-baseline gap-1 rounded border border-slate-600 bg-slate-800/90 px-2 py-0.5 text-xs">
                <span className="font-semibold tracking-wide text-slate-400">CUE</span>
                <span className="font-mono font-bold text-white">{cueOf(item) || '—'}</span>
              </span>
              <span className="text-slate-500">:</span>
              <ProgramTypeBadge type={item.programType} />
            </div>
            <h3 className="mt-1 truncate text-xl font-semibold text-white">{item.segmentName || 'Untitled'}</h3>
            <label className="mt-3 flex min-h-0 flex-1 flex-col text-xs font-semibold uppercase tracking-wide text-slate-500">
              Personal note
              <textarea
                value={note}
                onFocus={() => {
                  focusedNote.current = true;
                }}
                onBlur={() => {
                  focusedNote.current = false;
                  void saveNote(item.id);
                }}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                className="mt-1 min-h-0 w-full flex-1 resize-none rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-100"
                placeholder="Only you see this note."
              />
            </label>
          </div>
        ) : (
          <p className="p-4 text-sm text-slate-500">{live ? 'Nothing is running.' : 'No next cue with a duration.'}</p>
        )}
      </section>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-slate-700 bg-slate-900/95 px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-white">Producer Go · {eventName}</h1>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {days.length > 1
            ? days.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDay(n)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${day === n ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                >
                  Day {n}
                </button>
              ))
            : null}
          <span className={`max-w-[16rem] truncate text-xs ${error ? 'text-red-300' : 'text-emerald-300'}`}>
            {error || status}
          </span>
        </div>
      </header>

      <div className="flex-shrink-0 border-b border-slate-700 bg-slate-900/90 px-3 py-2">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-500">Current cue</p>
            {current ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-baseline gap-1 rounded border border-slate-600 bg-slate-800/90 px-2 py-0.5 text-xs">
                  <span className="font-semibold tracking-wide text-slate-400">CUE</span>
                  <span className="font-mono font-bold text-white">{cueOf(current) || '—'}</span>
                </span>
                <span className="text-slate-500">:</span>
                <ProgramTypeBadge type={current.programType} />
              </div>
            ) : null}
            <p className="mt-1 truncate text-base font-semibold text-white">
              {current ? current.segmentName || 'Untitled' : 'No cue running'}
            </p>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">Next</span>
              {next ? <ProgramTypeBadge type={next.programType} /> : null}
              <span className="truncate text-xs text-slate-400">
                {next ? `${cueOf(next) ? `${cueOf(next)} · ` : ''}${next.segmentName || 'Untitled'}` : 'No next cue'}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <div className="text-right">
              <p className={`text-sm font-bold ${current ? (remaining.overtime ? 'text-red-400' : 'text-emerald-400') : 'text-slate-500'}`}>
                {current ? (remaining.overtime ? 'Overtime' : 'Running') : 'Standby'}
              </p>
              <p className={`mt-0.5 font-mono text-4xl font-bold tabular-nums leading-none ${remaining.overtime ? 'text-red-400' : 'text-white'}`}>
                {remaining.label}
              </p>
            </div>
            <button
              type="button"
              disabled={!next || !user}
              onClick={() => void go()}
              className="rounded-xl bg-emerald-500 px-8 py-4 text-2xl font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Go
            </button>
          </div>
        </div>
        <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full border border-slate-600 bg-slate-700">
          <div
            className={`absolute right-0 top-0 h-full ${remaining.overtime ? 'bg-red-500' : 'bg-emerald-500'}`}
            style={{ width: `${remaining.pct}%` }}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-slate-400">Loading the rundown…</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {pane('Now', current, true)}
            <div className="w-px flex-shrink-0 bg-slate-700" />
            {pane('Next', next, false)}
          </div>

          <section className="flex h-[34%] min-h-[10rem] flex-shrink-0 flex-col overflow-hidden border-t border-slate-700 bg-slate-900/95 px-3 py-2">
            <div className="mb-1.5 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-amber-300">Columns · Now & Next</h2>
              <span className="text-xs text-slate-500">Space bar is Go, except while a note is focused.</span>
            </div>
            <div className="grid min-h-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden" style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(11rem, 1fr))` }}>
              {columns.map((col) => (
                <div key={col.id} className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-600 bg-slate-950/80 p-2">
                  <div className="mb-1 truncate text-[11px] font-bold uppercase tracking-wide text-sky-400">{col.name}</div>
                  <div className="grid min-h-0 flex-1 grid-rows-2 gap-1 overflow-hidden">
                    <div className="min-h-0 overflow-y-auto">
                      <div className="text-[10px] font-semibold uppercase text-emerald-400">Now</div>
                      <div className="whitespace-pre-wrap break-words text-sm text-white">
                        {col.id === 'programType' ? (
                          <ProgramTypeBadge type={current?.programType} />
                        ) : (
                          columnText(current, col) || <span className="text-slate-600">—</span>
                        )}
                      </div>
                    </div>
                    <div className="min-h-0 overflow-y-auto border-t border-slate-800 pt-1">
                      <div className="text-[10px] font-semibold uppercase text-amber-400/90">Next</div>
                      <div className="whitespace-pre-wrap break-words text-sm text-slate-200">
                        {col.id === 'programType' ? (
                          <ProgramTypeBadge type={next?.programType} />
                        ) : (
                          columnText(next, col) || <span className="text-slate-600">—</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default ProducerGoPage;
