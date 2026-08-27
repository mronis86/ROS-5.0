import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessCreative } from '../services/auth-service';
import { fetchCreativeEvent } from '../lib/creativeEventApi';
import {
  guestTimerElapsedSeconds,
  mergeGuestActiveTimer,
  stripHtmlNotes,
  type GuestActiveTimer,
  type GuestEventPayload,
  type GuestScheduleItem,
} from '../lib/eventGuestLinks';
import { socketClient } from '../services/socket-client';
import GuestRunOfShowGrid from '../components/guest/GuestRunOfShowGrid';
import GuestSpeakersModal from '../components/guest/GuestSpeakersModal';
import AppLogo from '../components/AppLogo';
import AppBrandTitle from '../components/AppBrandTitle';

const REST_FALLBACK_MS = 12000;
const ZOOM_STORAGE_KEY = 'creative-event-zoom';
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 0.85;

type HubTab = 'ros' | 'review';

function getStoredZoom(): number {
  try {
    const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
    if (raw == null) return ZOOM_DEFAULT;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX) return value;
  } catch {
    /* ignore */
  }
  return ZOOM_DEFAULT;
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function timerFromSocket(data: unknown): GuestActiveTimer | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const itemId = row.itemId ?? row.item_id;
  if (itemId == null) return null;
  const startedAt = row.startedAt ?? row.started_at;
  return {
    itemId: itemId as number | string,
    timerState: (row.timerState ?? row.timer_state) as string | undefined,
    isActive: !!(row.isActive ?? row.is_active),
    isRunning: !!(row.isRunning ?? row.is_running),
    durationSeconds: (row.durationSeconds ?? row.duration_seconds) as number | undefined,
    elapsedSeconds: Number(row.elapsedSeconds ?? row.elapsed_seconds) || 0,
    cueIs: String(row.cueIs ?? row.cue_is ?? ''),
    startedAt:
      startedAt instanceof Date
        ? startedAt.toISOString()
        : startedAt
          ? String(startedAt)
          : null,
  };
}

type SpeakerPanel = 'photos' | 'info';

const CreativeEventPage: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const eventId = (params.get('eventId') || '').trim();
  const eventNameParam = params.get('eventName') || '';
  const eventDateParam = params.get('eventDate') || '';
  const eventLocationParam = params.get('eventLocation') || '';

  const allowed = canAccessCreative(user);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<GuestEventPayload | null>(null);
  const [activeTimer, setActiveTimer] = useState<GuestActiveTimer | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [liveSynced, setLiveSynced] = useState(false);
  const [selectedDay, setSelectedDay] = useState(1);
  const [clockTick, setClockTick] = useState(0);
  const [query, setQuery] = useState('');
  const [zoomLevel, setZoomLevel] = useState<number>(getStoredZoom);
  const [speakersItemId, setSpeakersItemId] = useState<number | null>(null);
  const [speakerPanel, setSpeakerPanel] = useState<SpeakerPanel>('photos');
  const [hubTab, setHubTab] = useState<HubTab>('ros');

  const timerSyncRef = useRef<{ itemId: number | null; elapsed: number; clientAt: number }>({
    itemId: null,
    elapsed: 0,
    clientAt: 0,
  });
  const lastActiveItemIdRef = useRef<number | null>(null);
  const gotSyncRef = useRef(false);
  const restFallbackAttemptedRef = useRef(false);

  const setZoom = useCallback((value: number) => {
    const clamped = Math.max(
      ZOOM_MIN,
      Math.min(ZOOM_MAX, Math.round(value / ZOOM_STEP) * ZOOM_STEP)
    );
    const next = Number(clamped.toFixed(2));
    setZoomLevel(next);
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
  }, []);

  const applyTimer = useCallback((incoming: GuestActiveTimer | null | undefined) => {
    setActiveTimer(mergeGuestActiveTimer(incoming, timerSyncRef));
  }, []);

  const applyInitialPayload = useCallback(
    (data: GuestEventPayload, fromSocket = false) => {
      gotSyncRef.current = true;
      setPayload(data);
      setError(null);
      setLoading(false);
      applyTimer(data.activeTimer);
      if (fromSocket) setLiveSynced(true);
    },
    [applyTimer]
  );

  const restFallback = useCallback(async () => {
    if (!eventId || gotSyncRef.current || restFallbackAttemptedRef.current) return;
    restFallbackAttemptedRef.current = true;
    try {
      const data = await fetchCreativeEvent(eventId);
      if (!data.ok || data.error) {
        if (!gotSyncRef.current) {
          setError(data.error || 'Failed to load event.');
          setPayload(null);
          setLoading(false);
        }
        return;
      }
      applyInitialPayload(data, false);
    } catch (e) {
      if (!gotSyncRef.current) {
        setError(e instanceof Error ? e.message : 'Failed to load creative view.');
        setPayload(null);
        setLoading(false);
      }
    }
  }, [eventId, applyInitialPayload]);

  const refreshPayload = useCallback(async () => {
    if (!eventId) return;
    try {
      const data = await fetchCreativeEvent(eventId);
      if (data.ok && data.event) {
        setPayload((prev) => ({
          ...prev,
          ok: true,
          event: data.event ?? prev?.event,
          scheduleItems: data.scheduleItems ?? prev?.scheduleItems,
          activeTimer: data.activeTimer ?? prev?.activeTimer,
        }));
        applyTimer(data.activeTimer);
      }
    } catch {
      /* ignore background refresh errors */
    }
  }, [eventId, applyTimer]);

  const openContentReview = useCallback(() => {
    const name = payload?.event?.name || eventNameParam || 'Event';
    navigate(
      `/content-review?eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(name)}&viewer=1`
    );
  }, [eventId, eventNameParam, navigate, payload?.event?.name]);

  useEffect(() => {
    if (authLoading) return;
    if (!allowed) {
      navigate('/', { replace: true });
      return;
    }
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
    }
  }, [allowed, authLoading, eventId, navigate]);

  useEffect(() => {
    if (!eventId || !allowed) return;

    gotSyncRef.current = false;
    restFallbackAttemptedRef.current = false;
    setLoading(true);
    setError(null);
    setLiveSynced(false);
    setPayload(null);

    void restFallback();

    socketClient.connect(eventId, {
      onConnectionChange: (connected) => {
        setSocketConnected(connected);
        if (!connected) setLiveSynced(false);
        if (connected) setLiveSynced(true);
      },
      onTimerUpdated: (data) => applyTimer(timerFromSocket(data)),
      onTimerStarted: (data) => applyTimer(timerFromSocket(data)),
      onTimerStopped: () => applyTimer(null),
      onTimersStopped: () => applyTimer(null),
      onResetAllStates: () => applyTimer(null),
      onRunOfShowDataUpdated: () => {
        void refreshPayload();
      },
      onScheduleUpdated: () => {
        void refreshPayload();
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
    });

    const fallbackId = window.setTimeout(() => {
      void restFallback();
    }, REST_FALLBACK_MS);

    return () => {
      window.clearTimeout(fallbackId);
      socketClient.disconnect(eventId);
    };
  }, [eventId, allowed, applyTimer, restFallback, refreshPayload]);

  useEffect(() => {
    const id = window.setInterval(() => setClockTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const allItems = payload?.scheduleItems || [];
  const displayEventName = payload?.event?.name || eventNameParam || 'Event';
  const displayDate = payload?.event?.date || eventDateParam;
  const displayLocation = payload?.event?.location || eventLocationParam;

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
  const isLive = liveSynced && socketConnected;

  useEffect(() => {
    if (activeItemId == null || activeItemId === lastActiveItemIdRef.current) return;
    lastActiveItemIdRef.current = activeItemId;
    window.requestAnimationFrame(() => {
      const row = document.querySelector(`[data-item-id="${activeItemId}"]`);
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, [activeItemId]);

  if (authLoading || !allowed) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-300 flex items-center justify-center">
        Loading…
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200 pt-[var(--app-header-height)]">
      <div className="shrink-0 sticky top-[var(--app-header-height)] z-40 border-b border-slate-700/80 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto max-w-[1800px] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/creative')}
              className="shrink-0 rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              ← Events
            </button>
            <AppLogo size="sm" />
            <div className="min-w-0">
              <AppBrandTitle titleClassName="text-sm font-semibold text-white leading-tight" showTagline={false} />
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Creative · read only</p>
            </div>
          </div>
          <div className="text-right min-w-0">
            <p className="font-semibold text-white truncate max-w-[min(100vw-2rem,28rem)]">
              {displayEventName}
            </p>
            <p className="text-[11px] text-slate-400">
              {[displayDate, displayLocation].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-[1800px] px-4 pb-2 flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-2">
          <div className="flex rounded-lg border border-slate-600 bg-slate-800/50 p-0.5">
            <button
              type="button"
              onClick={() => setHubTab('ros')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                hubTab === 'ros' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Run of Show
            </button>
            <button
              type="button"
              onClick={() => {
                setHubTab('review');
                openContentReview();
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                hubTab === 'review' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Content Review
            </button>
          </div>
        </div>

        {payload && hubTab === 'ros' ? (
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
                            ? 'bg-violet-600 text-white'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        Day {day}
                      </button>
                    ))
                  : null}
                <span className="text-xs text-slate-500">{dayItems.length} cues</span>
                <div
                  className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900 overflow-hidden"
                  title="Zoom schedule to fit more on screen"
                >
                  <button
                    type="button"
                    onClick={() => setZoom(zoomLevel - ZOOM_STEP)}
                    disabled={zoomLevel <= ZOOM_MIN}
                    className="px-2.5 py-1.5 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(1)}
                    className="px-2 py-1.5 text-xs font-semibold tabular-nums text-slate-300 hover:bg-slate-800 border-x border-slate-700 min-w-[3.25rem]"
                    title="Reset to 100%"
                  >
                    {Math.round(zoomLevel * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(zoomLevel + ZOOM_STEP)}
                    disabled={zoomLevel >= ZOOM_MAX}
                    className="px-2.5 py-1.5 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                </div>
              </div>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search schedule…"
                className="min-w-[10rem] max-w-xs flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
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
        ) : payload && hubTab === 'ros' ? (
          <>
            <div
              className="flex-1 min-h-0 flex flex-col"
              style={{ zoom: zoomLevel } as React.CSSProperties}
            >
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
            </div>
            <p className="shrink-0 text-center text-[11px] text-slate-400 pt-2 pb-1">
              {isLive
                ? 'LIVE · connected for instant cue updates'
                : 'OFFLINE · reconnecting — cue changes may lag'}
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

export default CreativeEventPage;
