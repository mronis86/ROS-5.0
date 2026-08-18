import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessComms } from '../services/auth-service';
import { apiClient } from '../services/api-client';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';
import { itemNeedsRecording } from '../lib/cueRecording';

type ScheduleItem = {
  id: number;
  day?: number;
  programType?: string;
  segmentName?: string;
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
  needsRecording?: boolean;
  isIndented?: boolean;
  customFields?: { cue?: string };
};

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

function formatCue(item: ScheduleItem): string {
  const raw = String(item.customFields?.cue || '').trim();
  if (!raw) return '—';
  return /^cue\b/i.test(raw) ? raw : `CUE ${raw}`;
}

function parseScheduleItems(raw: unknown): ScheduleItem[] {
  let items = raw;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch {
      return [];
    }
  }
  return Array.isArray(items) ? (items as ScheduleItem[]) : [];
}

const CommsEventPage: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const eventId = params.get('eventId') || '';
  const eventNameParam = params.get('eventName') || '';

  const [eventName, setEventName] = useState(eventNameParam);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [day, setDay] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [filterRecording, setFilterRecording] = useState(false);
  const [search, setSearch] = useState('');

  const allowed = canAccessComms(user);
  const syncRef = useRef<(() => Promise<void>) | null>(null);

  const applyRos = useCallback((ros: any) => {
    if (!ros) return;
    setSchedule(parseScheduleItems(ros.schedule_items));
    if (ros.event_name) setEventName(String(ros.event_name));
  }, []);

  const loadStatic = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ros = await DatabaseService.getRunOfShowData(eventId);
      applyRos(ros);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, [applyRos, eventId]);

  syncRef.current = loadStatic;

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) {
      navigate('/', { replace: true });
      return;
    }
    void loadStatic();
  }, [allowed, authLoading, loadStatic, navigate]);

  useEffect(() => {
    if (!eventId || !allowed) return;
    socketClient.connect(eventId, {
      onRunOfShowDataUpdated: (data: any) => {
        if (!data) return;
        const incomingId = String(data.event_id || data.eventId || '');
        if (incomingId && incomingId !== String(eventId)) return;
        applyRos(data);
      },
      onInitialSync: async () => {
        await syncRef.current?.();
      },
    });
    return () => {
      socketClient.disconnect(eventId);
    };
  }, [allowed, applyRos, eventId]);

  const days = useMemo(() => {
    const set = new Set(schedule.map((s) => s.day || 1));
    const list = [...set].sort((a, b) => a - b);
    return list.length ? list : [1];
  }, [schedule]);

  useEffect(() => {
    if (!days.includes(day)) setDay(days[0] || 1);
  }, [day, days]);

  const dayRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return schedule.filter((item) => {
      if ((item.day || 1) !== day) return false;
      if (filterRecording && !itemNeedsRecording(item)) return false;
      if (!q) return true;
      const cue = formatCue(item).toLowerCase();
      const name = String(item.segmentName || '').toLowerCase();
      const type = String(item.programType || '').toLowerCase();
      return cue.includes(q) || name.includes(q) || type.includes(q);
    });
  }, [day, filterRecording, schedule, search]);

  const recordingCount = useMemo(
    () => schedule.filter((item) => (item.day || 1) === day && itemNeedsRecording(item)).length,
    [day, schedule]
  );

  const toggleRecording = async (item: ScheduleItem) => {
    const next = !itemNeedsRecording(item);
    setSchedule((prev) =>
      prev.map((row) => (row.id === item.id ? { ...row, needsRecording: next } : row))
    );
    setSavingId(item.id);
    setError(null);
    try {
      const result = await apiClient.setCueRecording(eventId, item.id, next);
      if (result?.schedule_items) applyRos(result);
    } catch (err) {
      setSchedule((prev) =>
        prev.map((row) => (row.id === item.id ? { ...row, needsRecording: !next } : row))
      );
      setError(err instanceof Error ? err.message : 'Failed to update recording flag');
    } finally {
      setSavingId(null);
    }
  };

  if (authLoading || !allowed) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-300 flex items-center justify-center">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white pt-[var(--app-header-height)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <button
              type="button"
              onClick={() => navigate('/comms')}
              className="text-sm text-slate-400 hover:text-white mb-1"
            >
              ← All events
            </button>
            <h1 className="text-xl sm:text-2xl font-bold text-white">{eventName || 'Comms'}</h1>
            <p className="text-slate-400 text-sm mt-1">
              Mark cues that need to be recorded. Those cues are outlined on the run of show.
            </p>
          </div>
          <div className="rounded-lg border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm">
            <div className="text-red-200 font-semibold">{recordingCount} marked to record</div>
            <div className="text-red-300/80 text-xs">Day {day}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {days.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold ${
                day === d ? 'bg-red-700 text-white' : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              Day {d}
            </button>
          ))}
          <label className="ml-auto inline-flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={filterRecording}
              onChange={(e) => setFilterRecording(e.target.checked)}
              className="rounded border-slate-500"
            />
            Recording only
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cue or segment…"
            className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm text-white focus:border-red-500 focus:outline-none w-full sm:w-64"
          />
        </div>

        {error ? (
          <div className="rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-red-200 text-sm mb-4">
            {error}
          </div>
        ) : null}

        <div className="bg-slate-800 rounded-xl border border-slate-600 overflow-hidden">
          {loading ? (
            <div className="px-4 py-10 text-center text-slate-400">Loading schedule…</div>
          ) : dayRows.length === 0 ? (
            <div className="px-4 py-10 text-center text-slate-400">
              {filterRecording ? 'No cues marked for recording on this day.' : 'No cues on this day.'}
            </div>
          ) : (
            <>
              <div className="md:hidden divide-y divide-slate-700">
                {dayRows.map((item) => {
                  const recording = itemNeedsRecording(item);
                  return (
                    <div
                      key={item.id}
                      className={`p-4 ${item.isIndented ? 'pl-8' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-mono text-sm font-semibold text-white">{formatCue(item)}</div>
                          <div className="text-white font-medium mt-1">{item.segmentName || '—'}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span
                              className="inline-flex rounded px-1.5 py-0.5 text-white"
                              style={{ backgroundColor: TYPE_COLOR[item.programType || ''] || '#475569' }}
                            >
                              {item.programType || '—'}
                            </span>
                            <span>{formatDuration(item)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={savingId === item.id}
                          onClick={() => void toggleRecording(item)}
                          className={`shrink-0 px-3 py-2 rounded-lg text-xs font-bold ${
                            recording
                              ? 'bg-red-600 hover:bg-red-500 text-white'
                              : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                          } disabled:opacity-50`}
                        >
                          {recording ? 'Recording' : 'Record'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-700">
                    <tr>
                      <th className="px-3 py-2 text-left text-slate-300 font-semibold text-sm">Cue</th>
                      <th className="px-3 py-2 text-left text-slate-300 font-semibold text-sm">Segment</th>
                      <th className="px-3 py-2 text-left text-slate-300 font-semibold text-sm">Type</th>
                      <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm">Duration</th>
                      <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm w-36">Record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayRows.map((item) => {
                      const recording = itemNeedsRecording(item);
                      return (
                        <tr
                          key={item.id}
                          className={`border-t border-slate-700 ${item.isIndented ? 'opacity-95' : ''}`}
                        >
                          <td className={`px-3 py-2 font-mono text-sm text-white ${item.isIndented ? 'pl-8' : ''}`}>
                            {formatCue(item)}
                          </td>
                          <td className="px-3 py-2 text-sm text-white">{item.segmentName || '—'}</td>
                          <td className="px-3 py-2">
                            <span
                              className="inline-flex rounded px-2 py-0.5 text-xs font-medium text-white"
                              style={{ backgroundColor: TYPE_COLOR[item.programType || ''] || '#475569' }}
                            >
                              {item.programType || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center text-sm text-slate-300">{formatDuration(item)}</td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              disabled={savingId === item.id}
                              onClick={() => void toggleRecording(item)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                                recording
                                  ? 'bg-red-600 hover:bg-red-500 text-white'
                                  : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                              } disabled:opacity-50`}
                            >
                              {recording ? 'Recording' : 'Record'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommsEventPage;
