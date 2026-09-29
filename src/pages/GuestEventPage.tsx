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
import { shouldUsePreshowRainbow } from '../lib/usePreshowRainbow';
import { findTopPreshowCue } from '../lib/preshowCountdown';
import {
  GUEST_COLUMN_FILTER_STORAGE_KEY,
  GUEST_COLUMN_ORDER_STORAGE_KEY,
  GUEST_COLUMN_TOGGLE_OPTIONS,
  GUEST_STICKY_START_STORAGE_KEY,
  loadGuestColumnOrder,
  loadGuestVisibleColumns,
  loadStickyStart,
  moveGuestColumnInOrder,
  normalizeGuestColumnOrder,
  type GuestScrollColumn,
  type GuestVisibleColumns,
} from '../lib/guestColumnPrefs';

const REST_FALLBACK_MS = 12000;
const ZOOM_STORAGE_KEY = 'guest-event-zoom';
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 0.85;

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

type SpeakerPanel = 'photos' | 'info';

const GuestEventPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('token') || '').trim();

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
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<GuestVisibleColumns>(() =>
    loadGuestVisibleColumns(GUEST_COLUMN_FILTER_STORAGE_KEY)
  );
  const [stickyStartColumn, setStickyStartColumn] = useState(() =>
    loadStickyStart(GUEST_STICKY_START_STORAGE_KEY)
  );
  const [columnOrder, setColumnOrder] = useState<GuestScrollColumn[]>(() =>
    loadGuestColumnOrder(GUEST_COLUMN_ORDER_STORAGE_KEY)
  );
  const [columnDragKey, setColumnDragKey] = useState<string | null>(null);

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

  const toggleColumn = useCallback((key: GuestScrollColumn) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      const anyOn = GUEST_COLUMN_TOGGLE_OPTIONS.some((opt) => next[opt.key]);
      if (!anyOn) return prev;
      try {
        localStorage.setItem(GUEST_COLUMN_FILTER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const persistStickyStart = useCallback((value: boolean) => {
    setStickyStartColumn(value);
    try {
      localStorage.setItem(GUEST_STICKY_START_STORAGE_KEY, value ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, []);

  const persistColumnOrder = useCallback((next: GuestScrollColumn[]) => {
    setColumnOrder(next);
    try {
      localStorage.setItem(GUEST_COLUMN_ORDER_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const moveColumn = useCallback(
    (from: number, to: number) => {
      persistColumnOrder(moveGuestColumnInOrder(columnOrder, from, to));
    },
    [columnOrder, persistColumnOrder]
  );

  const activeFilterCount = GUEST_COLUMN_TOGGLE_OPTIONS.filter(
    (opt) => !visibleColumns[opt.key]
  ).length;

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
      applyInitialPayload(data, false);
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
    setLiveSynced(false);

    guestSocketClient.connect(token, {
      onInitialSync: (data) => applyInitialPayload(data, true),
      onJoinError: (message, needsMigration) => {
        setLiveSynced(false);
        setError(
          needsMigration
            ? `${message} Run migration 052 on Neon.`
            : message
        );
        setPayload(null);
        setLoading(false);
      },
      onConnectionChange: (connected) => {
        setSocketConnected(connected);
        if (!connected) setLiveSynced(false);
      },
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
  const isLive = liveSynced && socketConnected;
  const usePreshowRainbowColors = shouldUsePreshowRainbow(null, {
    isRunning: timerRunning,
    programType: activeItem?.programType,
    itemId: activeItemId,
    topPreshowItemId: findTopPreshowCue(allItems)?.id ?? null,
  });

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
                        usePreshowRainbowColors
                          ? 'ros-rainbow-text'
                          : remaining != null && remaining < 0
                            ? 'text-red-300'
                            : 'text-white'
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
                <button
                  type="button"
                  onClick={() => setFilterPanelOpen((v) => !v)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    filterPanelOpen || activeFilterCount > 0 || stickyStartColumn
                      ? 'border-blue-500/70 bg-blue-950/50 text-blue-100'
                      : 'border-slate-600 text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  Columns{activeFilterCount > 0 ? ` (${activeFilterCount} hidden)` : ''}
                </button>
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
                className="min-w-[10rem] max-w-xs flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>

            {filterPanelOpen ? (
              <div className="mx-auto max-w-[1800px] px-4 pb-3">
                <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3 space-y-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
                      Show columns
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {GUEST_COLUMN_TOGGLE_OPTIONS.map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => toggleColumn(opt.key)}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border ${
                            visibleColumns[opt.key]
                              ? 'border-blue-500 bg-blue-900/40 text-blue-100'
                              : 'border-slate-600 text-slate-500'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label
                    className={`flex items-start gap-2 ${!visibleColumns.start ? 'opacity-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="rounded mt-0.5"
                      checked={stickyStartColumn}
                      disabled={!visibleColumns.start}
                      onChange={(e) => persistStickyStart(e.target.checked)}
                    />
                    <span className="text-sm text-slate-200">
                      Pin Start next to CUE
                      <span className="block text-xs text-slate-500">
                        Stays fixed on the left while other columns scroll
                      </span>
                    </span>
                  </label>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
                      Column order
                    </p>
                    <div className="space-y-1.5">
                      {columnOrder.map((key, index) => (
                        <div
                          key={key}
                          draggable
                          onDragStart={() => setColumnDragKey(key)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (!columnDragKey || columnDragKey === key) return;
                            const from = columnOrder.indexOf(columnDragKey as GuestScrollColumn);
                            const to = columnOrder.indexOf(key);
                            if (from >= 0 && to >= 0) moveColumn(from, to);
                            setColumnDragKey(null);
                          }}
                          onDragEnd={() => setColumnDragKey(null)}
                          className={`flex items-center gap-2 rounded border border-slate-600/80 bg-slate-800/60 px-2 py-1 ${
                            columnDragKey === key ? 'opacity-60 ring-1 ring-blue-400' : ''
                          }`}
                        >
                          <span className="cursor-grab text-slate-500 select-none px-1" aria-hidden>
                            ⋮⋮
                          </span>
                          <span className="flex-1 text-sm text-white truncate">
                            {GUEST_COLUMN_TOGGLE_OPTIONS.find((o) => o.key === key)?.label || key}
                          </span>
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveColumn(index, index - 1)}
                            className="px-1.5 text-slate-300 hover:text-white disabled:opacity-30"
                            title="Move up"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={index === columnOrder.length - 1}
                            onClick={() => moveColumn(index, index + 1)}
                            className="px-1.5 text-slate-300 hover:text-white disabled:opacity-30"
                            title="Move down"
                          >
                            ↓
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => persistColumnOrder(normalizeGuestColumnOrder(null))}
                      className="mt-2 text-[11px] text-slate-400 hover:text-white"
                    >
                      Reset order
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
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
                visibleColumns={visibleColumns}
                stickyStartColumn={stickyStartColumn}
                columnOrder={columnOrder}
                onOpenSpeakers={(itemId) => {
                  setSpeakersItemId(itemId);
                  setSpeakerPanel('photos');
                }}
              />
            </div>
            <p className="shrink-0 text-center text-[11px] text-slate-400 pt-2 pb-1">
              {isLive
                ? 'LIVE · WebSocket connected to Railway (instant cue updates)'
                : 'OFFLINE · reconnecting to live updates — cue changes may lag'}
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
