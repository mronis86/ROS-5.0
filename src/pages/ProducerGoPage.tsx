import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/database';
import { apiClient } from '../services/api-client';
import { socketClient } from '../services/socket-client';
import { stripHtmlNotes } from '../lib/eventGuestLinks';
import { getStoredOperatorName, operatorUserId } from '../lib/pinNotesOperator';

type Row = {
  id: number;
  day?: number;
  segmentName?: string;
  programType?: string;
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
  notes?: string;
  customFields?: Record<string, unknown>;
  mittiWatch?: boolean;
  avWatch?: boolean;
};

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

const ProducerGoPage: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();
  const eventId = new URLSearchParams(location.search).get('eventId') || '';
  const eventName = new URLSearchParams(location.search).get('eventName') || 'Producer Go';

  const [schedule, setSchedule] = useState<Row[]>([]);
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

  const remainingLabel = useMemo(() => {
    if (!current || !timer?.started_at) return formatDuration(current ? itemSeconds(current) : 0);
    const startMs = new Date(timer.started_at).getTime();
    if (!Number.isFinite(startMs)) return formatDuration(itemSeconds(current));
    const elapsed = Math.floor((Date.now() + clockOffset - startMs) / 1000);
    const total = Number(timer.duration_seconds) || itemSeconds(current);
    return formatRemaining(total, elapsed);
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

  const card = (label: string, item: Row | null, live: boolean) => {
    const seconds = item ? itemSeconds(item) : 0;
    const note = item ? (drafts[item.id] ?? notes[item.id] ?? '') : '';
    return (
      <section className={`flex min-h-0 flex-1 flex-col rounded-2xl border p-5 ${live ? 'border-emerald-600 bg-emerald-950/40' : 'border-slate-700 bg-slate-900'}`}>
        <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</div>
        {item ? (
          <>
            <div className="mt-2 text-sm text-slate-400">
              {cueOf(item) ? `Cue ${cueOf(item)}` : 'No cue number'}
              {item.programType ? ` · ${item.programType}` : ''}
            </div>
            <h2 className="mt-1 text-3xl font-semibold text-white">{item.segmentName || 'Untitled'}</h2>
            <div className={`mt-4 font-mono text-6xl tabular-nums ${live && remainingLabel.startsWith('+') ? 'text-red-400' : 'text-white'}`}>
              {live ? remainingLabel : formatDuration(seconds)}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void arm(item, 'mitti')}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${item.mittiWatch ? 'bg-amber-500 text-slate-950' : 'border border-slate-600 text-slate-200'}`}
              >
                {item.mittiWatch ? 'Mitti armed' : 'Arm Mitti'}
              </button>
              <button
                type="button"
                onClick={() => void arm(item, 'av')}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${item.avWatch ? 'bg-sky-500 text-slate-950' : 'border border-slate-600 text-slate-200'}`}
              >
                {item.avWatch ? 'AV armed' : 'Arm AV'}
              </button>
            </div>
            {item.notes ? (
              <p className="mt-4 whitespace-pre-wrap text-sm text-slate-300">{stripHtmlNotes(item.notes)}</p>
            ) : null}
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                rows={4}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-100"
                placeholder="Only you see this note."
              />
            </label>
          </>
        ) : (
          <p className="mt-6 text-slate-500">{live ? 'Nothing is running.' : 'No next cue with a duration.'}</p>
        )}
      </section>
    );
  };

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-5 py-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500">Producer Go</div>
          <div className="text-lg font-semibold">{eventName}</div>
        </div>
        {days.length > 1 && (
          <select
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
          >
            {days.map((n) => (
              <option key={n} value={n}>
                Day {n}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          disabled={!next || !user}
          onClick={() => void go()}
          className="ml-auto rounded-xl bg-emerald-500 px-8 py-3 text-lg font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Go
        </button>
      </header>
      {loading ? (
        <p className="p-6 text-slate-400">Loading the rundown…</p>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 p-4 md:grid-cols-2">
          {card('Now', current, true)}
          {card('Next', next, false)}
        </div>
      )}
      <footer className="flex items-center justify-between gap-3 border-t border-slate-800 px-5 py-2 text-sm">
        <span className="text-slate-500">Space bar does the same as Go, except while a note is focused.</span>
        <span className={error ? 'text-red-300' : 'text-emerald-300'}>{error || status}</span>
      </footer>
    </div>
  );
};

export default ProducerGoPage;
