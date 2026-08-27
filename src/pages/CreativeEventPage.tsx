import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessCreative } from '../services/auth-service';
import { fetchCreativeEvent } from '../lib/creativeEventApi';
import { stripHtmlNotes, type GuestEventPayload, type GuestScheduleItem } from '../lib/eventGuestLinks';
import GuestRunOfShowGrid from '../components/guest/GuestRunOfShowGrid';
import GuestSpeakersModal from '../components/guest/GuestSpeakersModal';
import AppLogo from '../components/AppLogo';
import AppBrandTitle from '../components/AppBrandTitle';

const ZOOM_STORAGE_KEY = 'creative-event-zoom';
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 0.85;

type HubTab = 'ros' | 'review';
type SpeakerPanel = 'photos' | 'info';

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

function dayStartLabel(
  day: number,
  masterStartTime?: string,
  dayStartTimes?: Record<number | string, string>
): string {
  if (dayStartTimes) {
    const keyed = dayStartTimes[day] ?? dayStartTimes[String(day)];
    if (keyed) return keyed;
  }
  return masterStartTime || '—';
}

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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<GuestEventPayload | null>(null);
  const [selectedDay, setSelectedDay] = useState(1);
  const [query, setQuery] = useState('');
  const [zoomLevel, setZoomLevel] = useState<number>(getStoredZoom);
  const [speakersItemId, setSpeakersItemId] = useState<number | null>(null);
  const [speakerPanel, setSpeakerPanel] = useState<SpeakerPanel>('photos');
  const [hubTab, setHubTab] = useState<HubTab>('ros');

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

  const loadSchedule = useCallback(
    async (isRefresh = false) => {
      if (!eventId) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const data = await fetchCreativeEvent(eventId);
        if (!data.ok || data.error) {
          setError(data.error || 'Failed to load schedule.');
          if (!isRefresh) setPayload(null);
          return;
        }
        setPayload(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load schedule.');
        if (!isRefresh) setPayload(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [eventId]
  );

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
      return;
    }
    void loadSchedule(false);
  }, [allowed, authLoading, eventId, loadSchedule, navigate]);

  const allItems = payload?.scheduleItems || [];
  const displayEventName = payload?.event?.name || eventNameParam || 'Event';
  const displayDate = payload?.event?.date || eventDateParam;
  const displayLocation = payload?.event?.location || eventLocationParam;
  const masterStartTime = payload?.event?.masterStartTime;
  const dayStartTimes = payload?.event?.dayStartTimes;

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

  const dayCueTotal = useMemo(
    () => allItems.filter((item) => (item.day || 1) === selectedDay).length,
    [allItems, selectedDay]
  );

  const speakersItem = allItems.find((item) => item.id === speakersItemId) || null;
  const selectedDayStart = dayStartLabel(selectedDay, masterStartTime, dayStartTimes);

  if (authLoading || !allowed) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-300 flex items-center justify-center">
        Loading…
      </div>
    );
  }

  return (
    <div
      id="creative-ros-reference"
      className="h-screen flex flex-col overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200 pt-[var(--app-header-height)] print:bg-white print:text-black"
    >
      <div className="shrink-0 sticky top-[var(--app-header-height)] z-40 border-b border-slate-700/80 bg-slate-900/95 backdrop-blur print:static print:border-slate-300 print:bg-white">
        <div className="mx-auto max-w-[1800px] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 print:hidden">
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
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Schedule reference</p>
            </div>
          </div>
          <div className="text-right min-w-0 flex-1">
            <p className="font-semibold text-white truncate max-w-[min(100vw-2rem,28rem)] print:text-black">
              {displayEventName}
            </p>
            <p className="text-[11px] text-slate-400 print:text-slate-600">
              {[displayDate, displayLocation].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-[1800px] px-4 pb-2 flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-2 print:hidden">
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
          <div className="mx-auto max-w-[1800px] px-4 pb-2.5 flex flex-wrap items-center gap-2 justify-between border-t border-slate-800/60 pt-2 print:border-slate-200">
            <div className="flex flex-wrap items-center gap-2">
              {daysFromItems > 1
                ? Array.from({ length: daysFromItems }, (_, i) => i + 1).map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold print:hidden ${
                        selectedDay === day
                          ? 'bg-violet-600 text-white'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      Day {day}
                    </button>
                  ))
                : null}
              <span className="text-xs text-slate-400 print:text-slate-600">
                Day {selectedDay} · start {selectedDayStart} · {dayCueTotal} cue
                {dayCueTotal === 1 ? '' : 's'}
                {query.trim() ? ` · ${dayItems.length} shown` : ''}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
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
              <button
                type="button"
                onClick={() => void loadSchedule(true)}
                disabled={refreshing}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
              >
                Print
              </button>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search schedule…"
                className="min-w-[10rem] max-w-xs rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              />
            </div>
          </div>
        ) : null}
      </div>

      <main className="flex-1 min-h-0 flex flex-col mx-auto w-full max-w-[1800px] px-4 py-3 print:py-0 print:px-2">
        {loading && !payload ? (
          <p className="text-slate-400 text-sm">Loading schedule…</p>
        ) : error && !payload ? (
          <div className="rounded-xl border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : payload && hubTab === 'ros' ? (
          <>
            <div
              className="flex-1 min-h-0 flex flex-col print:zoom-[0.85]"
              style={{ zoom: zoomLevel } as React.CSSProperties}
            >
              <GuestRunOfShowGrid
                schedule={allItems}
                filteredItems={dayItems}
                masterStartTime={masterStartTime}
                dayStartTimes={dayStartTimes}
                onOpenSpeakers={(itemId) => {
                  setSpeakersItemId(itemId);
                  setSpeakerPanel('photos');
                }}
              />
            </div>
            <p className="shrink-0 text-center text-[11px] text-slate-500 pt-2 pb-1 print:hidden">
              Static schedule reference — use Refresh after production updates the run of show.
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
