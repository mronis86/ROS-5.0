import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchGuestEvent,
  guestTimerElapsedSeconds,
  mergeGuestActiveTimer,
  stripHtmlNotes,
  type GuestActiveTimer,
  type GuestEventPayload,
  type GuestScheduleItem,
} from '../lib/eventGuestLinks';
import { guestSocketClient } from '../services/guest-socket-client';
import GuestRunOfShowGrid from '../components/guest/GuestRunOfShowGrid';
import GuestSpeakersModal from '../components/guest/GuestSpeakersModal';
import AppLogo from '../components/AppLogo';
import AppBrandTitle from '../components/AppBrandTitle';

const REST_FALLBACK_MS = 12000;

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

type SpeakerPanel = 'photos' | 'info';

const GuestEventPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('token') || '').trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<GuestEventPayload | null>(null);
  const [activeTimer, setActiveTimer] = useState<GuestActiveTimer | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [selectedDay, setSelectedDay] = useState(1);
  const [clockTick, setClockTick] = useState(0);
  const [query, setQuery] = useState('');
  const [speakersItemId, setSpeakersItemId] = useState<number | null>(null);
  const [speakerPanel, setSpeakerPanel] = useState<SpeakerPanel>('photos');

  const timerSyncRef = useRef<{ itemId: number | null; elapsed: number; clientAt: number }>({
    itemId: null,
    elapsed: 0,
    clientAt: 0,
  });
  const lastActiveItemIdRef = useRef<number | null>(null);
  const gotSyncRef = useRef(false);
  const restFallbackAttemptedRef = useRef(false);

  const applyTimer = useCallback((incoming: GuestActiveTimer | null | undefined) => {
    setActiveTimer(mergeGuestActiveTimer(incoming, timerSyncRef));
  }, []);

  const applyInitialPayload = useCallback(
    (data: GuestEventPayload) => {
      gotSyncRef.current = true;
      setPayload(data);
      setError(null);
      setLoading(false);
      applyTimer(data.activeTimer);
    },
    [applyTimer]
  );

  const restFallback = useCallback(async () => {
    if (!token || gotSyncRef.current || restFallbackAttemptedRef.current) return;
    restFallbackAttemptedRef.current = true;
    try {
      const data = await fetchGuestEvent(token);
      if (!data.ok || data.error) {
        if (!gotSyncRef.current) {
          setError(data.error || 'Invalid guest link.');
          setPayload(null);
          setLoading(false);
        }
        return;
      }
      applyInitialPayload(data);
    } catch (e) {
      if (!gotSyncRef.current) {
        setError(e instanceof Error ? e.message : 'Failed to load guest view.');
        setPayload(null);
        setLoading(false);
      }
    }
  }, [token, applyInitialPayload]);

  useEffect(() => {
    if (!token) {
      setError('This guest link is missing a token.');
      setLoading(false);
      return;
    }

    gotSyncRef.current = false;
    restFallbackAttemptedRef.current = false;
    setLoading(true);
    setError(null);

    guestSocketClient.connect(token, {
      onInitialSync: applyInitialPayload,
      onJoinError: (message, needsMigration) => {
        setError(
          needsMigration
            ? `${message} Run migration 052 on Neon.`
            : message
        );
        setPayload(null);
        setLoading(false);
      },
      onConnectionChange: setSocketConnected,
      onTimerUpdated: applyTimer,
      onScheduleUpdated: (data) => {
        setPayload((prev) => {
          if (!prev?.event) return prev;
          return {
            ...prev,
            scheduleItems: data.scheduleItems ?? prev.scheduleItems,
            event: {
              ...prev.event,
              masterStartTime: data.masterStartTime ?? prev.event.masterStartTime,
              dayStartTimes: data.dayStartTimes ?? prev.event.dayStartTimes,
              numberOfDays: data.numberOfDays ?? prev.event.numberOfDays,
            },
          };
        });
      },
      onIndentedCuesUpdated: (data) => {
        setPayload((prev) => {
          if (!prev?.scheduleItems) return prev;
          let items: GuestScheduleItem[] = prev.scheduleItems;
          if (data.cleared) {
            items = items.map((item) => ({ ...item, isIndented: false }));
          } else if (data.removed && data.itemId != null) {
            const id = String(data.itemId);
            items = items.map((item) =>
              String(item.id) === id ? { ...item, isIndented: false } : item
            );
          } else if (data.itemId != null) {
            const id = String(data.itemId);
            items = items.map((item) =>
              String(item.id) === id ? { ...item, isIndented: data.indented !== false } : item
            );
          }
          return { ...prev, scheduleItems: items };
        });
      },
      onResetAllStates: () => {
        applyTimer(null);
      },
    });

    const fallbackId = window.setTimeout(() => {
      void restFallback();
    }, REST_FALLBACK_MS);

    return () => {
      window.clearTimeout(fallbackId);
      guestSocketClient.disconnect();
    };
  }, [token, applyInitialPayload, applyTimer, restFallback]);

  useEffect(() => {
    const id = window.setInterval(() => setClockTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const allItems = payload?.scheduleItems || [];
  const daysFromItems = useMemo(() => {
    const max = allItems.reduce((acc, item) => Math.max(acc, Number(item.day) || 1), 1);
    return Math.max(1, Number(payload?.event?.numberOfDays) || 1, max);
  }, [allItems, payload?.event?.numberOfDays]);

  const dayItems = useMemo(() => {
    let rows = allItems.filter((item) => (item.day || 1) === selectedDay);
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((item) => {
      const notes = stripHtmlNotes(item.notes || '').toLowerCase();
      return (
        String(item.cue || '').toLowerCase().includes(q) ||
        String(item.segmentName || '').toLowerCase().includes(q) ||
        String(item.programType || '').toLowerCase().includes(q) ||
        String(item.speakersText || '').toLowerCase().includes(q) ||
        notes.includes(q)
      );
    });
  }, [allItems, selectedDay, query]);

  const activeItemId = activeTimer?.itemId != null ? Number(activeTimer.itemId) : null;
  const activeItem = allItems.find((item) => item.id === activeItemId) || null;
  const speakersItem = allItems.find((item) => item.id === speakersItemId) || null;

  const elapsedSeconds = useMemo(
    () => guestTimerElapsedSeconds(activeTimer, timerSyncRef),
    [activeTimer, clockTick]
  );

  const timerRunning = Boolean(activeTimer?.isRunning && activeItemId);
  const timerLoaded = Boolean(activeTimer && activeItemId && !activeTimer.isRunning);

  const remaining = useMemo(() => {
    if (!activeTimer) return null;
    return (Number(activeTimer.durationSeconds) || 0) - elapsedSeconds;
  }, [activeTimer, elapsedSeconds]);

  const statusLabel = timerRunning ? 'RUNNING' : timerLoaded ? 'LOADED' : 'STANDBY';
  const statusClass = timerRunning
    ? 'text-green-400'
    : timerLoaded
      ? 'text-yellow-400'
      : 'text-slate-400';

  useEffect(() => {
    if (activeItemId == null || activeItemId === lastActiveItemIdRef.current) return;
    lastActiveItemIdRef.current = activeItemId;
    window.requestAnimationFrame(() => {
      const row = document.querySelector(`[data-item-id="${activeItemId}"]`);
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, [activeItemId]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200">
      <div className="shrink-0 sticky top-0 z-40 border-b border-slate-700/80 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto max-w-[1800px] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <AppLogo size="sm" />
            <div className="min-w-0">
              <AppBrandTitle titleClassName="text-sm font-semibold text-white leading-tight" showTagline={false} />
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Guest view · read only</p>
            </div>
          </div>
          {payload?.event ? (
            <div className="text-right min-w-0">
              <p className="font-semibold text-white truncate max-w-[min(100vw-2rem,28rem)]">
                {payload.event.name}
              </p>
              <p className="text-[11px] text-slate-400">
                {[payload.event.date, payload.event.location].filter(Boolean).join(' · ')}
              </p>
            </div>
          ) : null}
        </div>

        {payload ? (
          <>
            <div className="mx-auto max-w-[1800px] px-4 pb-2.5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-2">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Current cue</p>
                <p className="text-base sm:text-lg font-semibold text-white truncate">
                  {activeItem?.segmentName || activeTimer?.cueIs || 'No cue loaded'}
                </p>
                <p className="text-xs text-slate-400 font-mono truncate">
                  {activeItem?.cue ? `CUE ${activeItem.cue}` : activeTimer?.cueIs || '—'}
                  {activeItem?.programType ? ` · ${activeItem.programType}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <p className={`text-sm font-bold ${statusClass}`}>{statusLabel}</p>
                  {activeTimer ? (
                    <p
                      className={`text-2xl sm:text-3xl font-mono font-bold tabular-nums leading-none mt-0.5 ${
                        remaining != null && remaining < 0 ? 'text-red-300' : 'text-white'
                      }`}
                    >
                      {remaining != null
                        ? remaining < 0
                          ? `+${formatClock(Math.abs(remaining))}`
                          : formatClock(remaining)
                        : formatClock(elapsedSeconds)}
                    </p>
                  ) : (
                    <p className="text-2xl font-mono font-bold text-slate-600 mt-0.5">—:—</p>
                  )}
                  <p className="text-[10px] text-slate-500">
                    {timerRunning ? 'Remaining' : timerLoaded ? 'Timer loaded' : 'Counter'}
                  </p>
                </div>
              </div>
            </div>

            <div className="mx-auto max-w-[1800px] px-4 pb-2.5 flex flex-wrap items-center gap-2 justify-between border-t border-slate-800/60 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                {daysFromItems > 1
                  ? Array.from({ length: daysFromItems }, (_, i) => i + 1).map((day) => (
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
                    ))
                  : null}
                <span className="text-xs text-slate-500">{dayItems.length} cues</span>
              </div>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search schedule…"
                className="min-w-[10rem] max-w-xs flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>
          </>
        ) : null}
      </div>

      <main className="flex-1 min-h-0 flex flex-col mx-auto w-full max-w-[1800px] px-4 py-3">
        {loading && !payload ? (
          <p className="text-slate-400 text-sm">Loading run of show…</p>
        ) : error && !payload ? (
          <div className="rounded-xl border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : payload ? (
          <>
            <GuestRunOfShowGrid
              schedule={allItems}
              filteredItems={dayItems}
              masterStartTime={payload.event?.masterStartTime}
              dayStartTimes={payload.event?.dayStartTimes}
              activeItemId={activeItemId}
              timerRunning={timerRunning}
              timerLoaded={timerLoaded}
              onOpenSpeakers={(itemId) => {
                setSpeakersItemId(itemId);
                setSpeakerPanel('photos');
              }}
            />
            <p className="shrink-0 text-center text-[10px] text-slate-500 pt-2 pb-1">
              {socketConnected
                ? 'Live updates via WebSocket'
                : 'Reconnecting… schedule loaded, live cue may lag briefly'}
            </p>
          </>
        ) : null}
      </main>

      <GuestSpeakersModal
        open={speakersItemId != null}
        item={speakersItem}
        panel={speakerPanel}
        onPanelChange={setSpeakerPanel}
        onClose={() => setSpeakersItemId(null)}
      />
    </div>
  );
};

export default GuestEventPage;
