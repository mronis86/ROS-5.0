import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/database';
import { apiClient } from '../services/api-client';
import { socketClient } from '../services/socket-client';
import { ROS_PROGRAM_TYPE_COLORS } from '../lib/guestRosHelpers';
import { programTypeSurfaceStyle } from '../lib/rosProgramTypeSplit';
import { isIndentedScheduleItem } from '../lib/scheduleStartTime';

type Row = {
  id: number;
  day?: number;
  segmentName?: string;
  programType?: string;
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
  customFields?: Record<string, unknown>;
  isIndented?: boolean;
  isTimedMarker?: boolean;
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
  return cue == null ? '' : String(cue).trim();
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

function rowId(row: Row): number {
  const id = Number(row.id);
  return Number.isFinite(id) ? id : -1;
}

function timerIsRunning(timer: any): boolean {
  if (!timer || timer.cleared === true || timer.is_active === false) return false;
  const state = String(timer.timer_state || timer.timerState || '').toLowerCase();
  if (state === 'stopped' || state === 'loaded' || state === 'armed') return false;
  return state === 'running' || timer.is_running === true || timer.is_running === 1;
}

function ProgramBadge({ type }: { type?: string }) {
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
      className="inline-flex max-w-[12rem] truncate rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none"
      style={{ ...surface, color: text }}
    >
      {label}
    </span>
  );
}

const DirectorControlPopout: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();
  const params = new URLSearchParams(location.search);
  const eventId = params.get('eventId') || '';
  const eventName = params.get('eventName') || 'Show control';

  const [schedule, setSchedule] = useState<Row[]>([]);
  const [day, setDay] = useState(1);
  const [timer, setTimer] = useState<any | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState('');
  const going = useRef(false);
  const timerRev = useRef(0);
  const lastRunningId = useRef<number | null>(null);

  const indented = useMemo(() => {
    const map: Record<number, boolean> = {};
    for (const row of schedule) {
      if (row.isIndented || row.isTimedMarker) map[row.id] = true;
    }
    return map;
  }, [schedule]);

  const playable = useCallback(
    (row: Row) => !isIndentedScheduleItem(row, indented) && itemSeconds(row) > 0,
    [indented]
  );

  const days = useMemo(() => {
    const set = new Set<number>();
    schedule.forEach((row) => set.add(row.day || 1));
    return Array.from(set).sort((a, b) => a - b);
  }, [schedule]);

  const runningId = timerIsRunning(timer) ? itemIdOf(timer) : null;
  const loadedId =
    runningId == null && timer && timer.is_active !== false && String(timer.timer_state || '').toLowerCase() !== 'stopped'
      ? itemIdOf(timer)
      : null;
  const current = useMemo(
    () => (runningId != null ? schedule.find((row) => rowId(row) === runningId) || null : null),
    [schedule, runningId]
  );

  const next = useMemo(() => {
    const after = (anchorId: number | null) => {
      if (anchorId == null) return null;
      const idx = schedule.findIndex((row) => rowId(row) === anchorId);
      if (idx < 0) return null;
      for (let i = idx + 1; i < schedule.length; i += 1) {
        if (playable(schedule[i])) return schedule[i];
      }
      return null;
    };
    if (current) return after(rowId(current));
    if (loadedId != null) {
      const loaded = schedule.find((row) => rowId(row) === loadedId);
      if (loaded && playable(loaded)) return loaded;
      const following = after(loadedId);
      if (following) return following;
    }
    const followingLast = after(lastRunningId.current);
    if (followingLast) return followingLast;
    const onDay = schedule.filter((row) => (row.day || 1) === day);
    return (onDay.length ? onDay : schedule).find((row) => playable(row)) || null;
  }, [current, loadedId, schedule, playable, day]);

  const loadSchedule = useCallback(async () => {
    if (!eventId) return;
    try {
      const data = await DatabaseService.getRunOfShowData(eventId);
      const rows = Array.isArray(data?.schedule_items) ? data.schedule_items : [];
      setSchedule(rows.map((row: Row) => ({ ...row, id: rowId(row) })));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the rundown.');
    }
  }, [eventId]);

  const applyTimer = useCallback((raw: any) => {
    const nextTimer = pickActiveTimer(raw);
    if (timerIsRunning(nextTimer)) {
      const id = itemIdOf(nextTimer);
      if (id != null) lastRunningId.current = id;
    }
    setTimer(nextTimer);
  }, []);

  const refreshTimer = useCallback(async () => {
    const rev = timerRev.current;
    try {
      const row = await DatabaseService.getActiveTimer(eventId);
      if (rev !== timerRev.current) return;
      applyTimer(row);
    } catch {
      /* a newer socket update already has the position */
    }
  }, [eventId, applyTimer]);

  const acceptSocketTimer = useCallback(
    (raw: any) => {
      timerRev.current += 1;
      applyTimer(raw);
    },
    [applyTimer]
  );

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    if (!eventId) return undefined;
    void refreshTimer();
    socketClient.connect(
      eventId,
      {
        onInitialSync: () => {
          void refreshTimer();
        },
        onTimerUpdated: (data: any) => acceptSocketTimer(data),
        onTimerStarted: (data: any) =>
          acceptSocketTimer({ ...data, is_running: true, is_active: true, timer_state: 'running' }),
        onTimerStopped: (data: any) => {
          timerRev.current += 1;
          if (going.current) return;
          const stoppedId = itemIdOf(data);
          setTimer((prev) => {
            const prevId = itemIdOf(prev);
            if (prev && timerIsRunning(prev) && stoppedId != null && prevId !== stoppedId) return prev;
            return null;
          });
        },
        onTimersStopped: () => {
          timerRev.current += 1;
          if (going.current) return;
          lastRunningId.current = null;
          setTimer(null);
        },
        onResetAllStates: () => {
          timerRev.current += 1;
          lastRunningId.current = null;
          setTimer(null);
        },
        onActiveTimersUpdated: (data: any) => acceptSocketTimer(data),
        onRunOfShowDataUpdated: () => {
          void loadSchedule();
        },
        onServerTime: (data: any) => {
          const serverMs = data?.serverTime ? new Date(data.serverTime).getTime() : NaN;
          if (Number.isFinite(serverMs)) setClockOffset(serverMs - Date.now());
        },
      } as any,
      'director-control'
    );
    return () => {
      try {
        socketClient.disconnect(eventId, 'director-control');
      } catch {
        /* already closed */
      }
    };
  }, [eventId, acceptSocketTimer, refreshTimer, loadSchedule]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);

  const remaining = useMemo(() => {
    const total = current ? Number(timer?.duration_seconds) || itemSeconds(current) : 0;
    if (!current || !timer?.started_at) return { label: '—:—', overtime: false };
    const startMs = new Date(timer.started_at).getTime();
    if (!Number.isFinite(startMs)) return { label: formatDuration(total), overtime: false };
    const elapsed = Math.floor((Date.now() + clockOffset - startMs) / 1000);
    return { label: formatRemaining(total, elapsed), overtime: total - elapsed < 0 };
  }, [current, timer, clockOffset, tick]);

  const go = useCallback(async () => {
    if (!eventId || !user?.id || !next || going.current) return;
    going.current = true;
    timerRev.current += 1;
    setError('');
    setTimer({
      item_id: rowId(next),
      is_running: true,
      is_active: true,
      timer_state: 'running',
      duration_seconds: itemSeconds(next),
      started_at: new Date(Date.now() + clockOffset).toISOString(),
    });
    try {
      if (runningId != null && runningId !== rowId(next)) {
        await DatabaseService.stopTimer(eventId, runningId, user.id, user.full_name, user.role);
      }
      const ok = await DatabaseService.startTimer(
        eventId,
        next.id,
        user.id,
        itemSeconds(next),
        new Date(Date.now() + clockOffset),
        undefined,
        cueOf(next) || undefined
      );
      if (ok) lastRunningId.current = rowId(next);
      else {
        setError('Go did not start the timer.');
        void refreshTimer();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Go failed.');
    } finally {
      going.current = false;
    }
  }, [eventId, user, next, runningId, clockOffset, refreshTimer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON' || target.isContentEditable)) return;
      e.preventDefault();
      void go();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const arm = async (kind: 'mitti' | 'av') => {
    if (!eventId || !next) return;
    const enabled = kind === 'mitti' ? !next.mittiWatch : !next.avWatch;
    setSchedule((rows) =>
      rows.map((row) =>
        row.id === next.id ? { ...row, ...(kind === 'mitti' ? { mittiWatch: enabled } : { avWatch: enabled }) } : row
      )
    );
    try {
      if (kind === 'mitti') await apiClient.setMittiWatch(eventId, next.id, enabled);
      else await apiClient.setAvWatch(eventId, next.id, enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not arm the video.');
      void loadSchedule();
    }
  };

  if (!eventId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-sm text-slate-300">
        Open Show control from Director view.
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 px-4 py-3 text-slate-100">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Show control</div>
          <div className="truncate text-xs text-slate-400">{eventName}</div>
        </div>
        {!current && days.length > 1 ? (
          <div className="flex gap-1">
            {days.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDay(n)}
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${day === n ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}
              >
                {n}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${remaining.overtime ? 'text-red-400' : 'text-emerald-400'}`}>
            {current ? (remaining.overtime ? 'Overtime' : 'On now') : 'Standby'}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="font-mono text-xs text-slate-400">{current && cueOf(current) ? `CUE ${cueOf(current)}` : ''}</span>
            <ProgramBadge type={current?.programType} />
          </div>
          <div className="mt-1 truncate text-lg font-semibold">{current?.segmentName || 'Nothing is running'}</div>
        </div>
        <div className={`font-mono text-4xl font-semibold tabular-nums leading-none ${remaining.overtime ? 'text-red-400' : 'text-white'}`}>
          {remaining.label}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-400">Next</div>
        {next ? (
          <>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="font-mono text-xs text-slate-400">{cueOf(next) ? `CUE ${cueOf(next)}` : 'No cue'}</span>
              <ProgramBadge type={next.programType} />
              <span className="font-mono text-xs text-slate-500">{formatDuration(itemSeconds(next))}</span>
            </div>
            <div className="mt-1 truncate text-base font-semibold">{next.segmentName || 'Untitled'}</div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void arm('mitti')}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${next.mittiWatch ? 'bg-amber-400 text-slate-950' : 'text-slate-300 ring-1 ring-slate-600'}`}
              >
                {next.mittiWatch ? 'Mitti on' : 'Mitti'}
              </button>
              <button
                type="button"
                onClick={() => void arm('av')}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${next.avWatch ? 'bg-sky-400 text-slate-950' : 'text-slate-300 ring-1 ring-slate-600'}`}
              >
                {next.avWatch ? 'AV on' : 'AV'}
              </button>
              <button
                type="button"
                disabled={!user}
                onClick={() => void go()}
                className="ml-auto rounded-full bg-emerald-500 px-6 py-2 text-base font-bold text-slate-950 disabled:opacity-40"
              >
                Go
              </button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-500">No next cue with a duration.</p>
        )}
      </div>

      <div className="mt-auto pt-3 text-[11px] text-slate-500">{error || 'Space bar is Go.'}</div>
    </div>
  );
};

export default DirectorControlPopout;
