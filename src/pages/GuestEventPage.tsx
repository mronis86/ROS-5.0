import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchGuestEvent,
  formatGuestDuration,
  stripHtmlNotes,
  type GuestEventPayload,
  type GuestScheduleItem,
} from '../lib/eventGuestLinks';
import AppLogo from '../components/AppLogo';
import AppBrandTitle from '../components/AppBrandTitle';

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

const GuestEventPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('token') || '').trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<GuestEventPayload | null>(null);
  const [selectedDay, setSelectedDay] = useState(1);
  const [tickElapsed, setTickElapsed] = useState(0);

  const load = useCallback(async () => {
    if (!token) {
      setError('This guest link is missing a token.');
      setLoading(false);
      return;
    }
    try {
      const data = await fetchGuestEvent(token);
      if (!data.ok || data.error) {
        setError(data.error || 'Invalid guest link.');
        setPayload(null);
        return;
      }
      setPayload(data);
      setError(null);
      const timer = data.activeTimer;
      setTickElapsed(Number(timer?.elapsedSeconds) || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load guest view.');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const timer = payload?.activeTimer;
    if (!timer?.isRunning) return;
    const id = window.setInterval(() => {
      setTickElapsed((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [payload?.activeTimer?.isRunning, payload?.activeTimer?.itemId, payload?.serverTime]);

  useEffect(() => {
    const timer = payload?.activeTimer;
    setTickElapsed(Number(timer?.elapsedSeconds) || 0);
  }, [payload?.activeTimer?.elapsedSeconds, payload?.activeTimer?.itemId, payload?.serverTime]);

  const days = Math.max(1, Number(payload?.event?.numberOfDays) || 1);
  const dayItems = useMemo(() => {
    const items = payload?.scheduleItems || [];
    return items.filter((item) => (item.day || 1) === selectedDay);
  }, [payload?.scheduleItems, selectedDay]);

  const activeItemId = payload?.activeTimer?.itemId != null ? Number(payload.activeTimer.itemId) : null;
  const activeItem = dayItems.find((item) => item.id === activeItemId) ||
    (payload?.scheduleItems || []).find((item) => item.id === activeItemId);

  const remaining = useMemo(() => {
    const timer = payload?.activeTimer;
    if (!timer) return null;
    const duration = Number(timer.durationSeconds) || 0;
    return duration - tickElapsed;
  }, [payload?.activeTimer, tickElapsed]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-slate-100">
      <header className="border-b border-slate-700/80 bg-slate-950/70 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <AppLogo size="sm" />
            <div className="min-w-0">
              <AppBrandTitle titleClassName="text-base font-semibold text-white leading-tight" showTagline={false} />
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Guest view · read only</p>
            </div>
          </div>
          {payload?.event ? (
            <div className="text-right min-w-0">
              <p className="font-semibold text-white truncate max-w-[min(100vw-2rem,24rem)]">{payload.event.name}</p>
              <p className="text-xs text-slate-400">
                {[payload.event.date, payload.event.location].filter(Boolean).join(' · ')}
              </p>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-5">
        {loading && !payload ? (
          <p className="text-slate-400 text-sm">Loading event…</p>
        ) : error && !payload ? (
          <div className="rounded-xl border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : payload ? (
          <>
            {activeItem || payload.activeTimer ? (
              <section className="rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-emerald-300/80">
                    {payload.activeTimer?.isRunning ? 'Now running' : 'Current cue'}
                  </p>
                  <p className="text-lg font-semibold text-white truncate">
                    {activeItem?.segmentName || payload.activeTimer?.cueIs || '—'}
                  </p>
                  {activeItem?.cue ? (
                    <p className="text-sm text-emerald-200/80 font-mono">CUE {activeItem.cue}</p>
                  ) : null}
                </div>
                {remaining != null && payload.activeTimer ? (
                  <div className="text-right">
                    <p
                      className={`text-3xl font-mono font-bold tabular-nums ${
                        remaining < 0 ? 'text-red-300' : 'text-white'
                      }`}
                    >
                      {remaining < 0 ? `+${formatClock(Math.abs(remaining))}` : formatClock(remaining)}
                    </p>
                    <p className="text-xs text-slate-400">
                      {payload.activeTimer.isRunning ? 'Remaining' : 'Timer'}
                    </p>
                  </div>
                ) : null}
              </section>
            ) : null}

            {days > 1 ? (
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: days }, (_, i) => i + 1).map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSelectedDay(day)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      selectedDay === day
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    Day {day}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-xl border border-slate-700 bg-slate-900/60">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-950/80 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">Cue</th>
                    <th className="px-3 py-2.5">Segment</th>
                    <th className="px-3 py-2.5">Duration</th>
                    <th className="px-3 py-2.5">Speakers</th>
                    <th className="px-3 py-2.5">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {dayItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                        No cues for this day yet.
                      </td>
                    </tr>
                  ) : (
                    dayItems.map((item: GuestScheduleItem) => {
                      const isActive = activeItemId != null && item.id === activeItemId;
                      const notes = stripHtmlNotes(item.notes || '');
                      return (
                        <tr
                          key={item.id}
                          className={`border-t border-slate-800 ${
                            isActive ? 'bg-emerald-950/40' : item.isIndented ? 'bg-slate-950/20' : ''
                          }`}
                        >
                          <td className={`px-3 py-2.5 font-mono text-xs ${item.isIndented ? 'pl-6 text-slate-400' : 'text-amber-300'}`}>
                            {item.cue || '—'}
                          </td>
                          <td className={`px-3 py-2.5 ${item.isIndented ? 'pl-6' : ''}`}>
                            <span className={`font-medium ${isActive ? 'text-emerald-100' : 'text-white'}`}>
                              {item.segmentName || '—'}
                            </span>
                            {item.programType ? (
                              <span className="ml-2 text-[11px] text-slate-500">{item.programType}</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">{formatGuestDuration(item)}</td>
                          <td className="px-3 py-2.5 text-slate-300 max-w-[12rem]">
                            <span className="line-clamp-2">{item.speakers || '—'}</span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-400 max-w-[18rem]">
                            <span className="line-clamp-3 whitespace-pre-wrap">{notes || '—'}</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <p className="text-center text-[11px] text-slate-500">
              View only · updates every few seconds · no sign-in required
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
};

export default GuestEventPage;
