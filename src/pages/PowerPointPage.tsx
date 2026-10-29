import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getApiBaseUrl, getAppDownloadUrl } from '../services/api-client';
import { apiAuthFetch, apiJsonHeaders } from '../lib/sessionAuth';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';
import { normalizeCueLabel } from '../lib/cueCards';
import PptClockFeedControls from '../components/PptClockFeedControls';
import { usePptClockPublisher } from '../hooks/usePptClockPublisher';

type PptAction = 'none' | 'load' | 'load_start' | 'start' | 'stop';
type SlideView = 'grid' | 'list';

type PptBinding = {
  itemId: number | null;
  action: PptAction;
};

type PptSlide = {
  pptSlideId: string;
  slideIndex: number;
  title: string;
  imageUrl: string;
  signedUrl?: string | null;
  hasImage: boolean;
  expiresAt?: string | null;
  binding: PptBinding;
};

type PptSession = {
  eventId: string | null;
  deckName: string;
  slideCount: number;
  connected: boolean;
  slideshowActive: boolean;
  currentSlideId: string | null;
  currentIndex: number | null;
  lastSeen: string | null;
  lastAction: string | null;
  lastItemId: number | null;
};

type ScheduleCueOption = {
  id: number;
  label: string;
  segmentName: string;
};

const ACTION_OPTIONS: { id: PptAction; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'load', label: 'Load cue' },
  { id: 'load_start', label: 'Load + start' },
  { id: 'start', label: 'Start timer' },
  { id: 'stop', label: 'Stop clock' },
];

const CUE_REQUIRED_ACTIONS = new Set<PptAction>(['load', 'load_start', 'start']);
const VIEW_STORAGE_KEY = 'ros-ppt-slide-view';

function readSlideView(): SlideView {
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === 'list' || stored === 'grid') return stored;
  } catch {
    /* ignore */
  }
  return 'grid';
}

function formatLastSeen(raw: string | null): string {
  if (!raw) return 'never';
  const ms = Date.now() - new Date(raw).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  if (ms < 4000) return 'just now';
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  return `${Math.round(ms / 60000)}m ago`;
}

function StillImage({ slide, className = '' }: { slide: PptSlide; className?: string }) {
  const [src, setSrc] = useState(slide.signedUrl || '');

  useEffect(() => {
    if (!slide.hasImage) {
      setSrc('');
      return;
    }
    if (slide.signedUrl) {
      setSrc(slide.signedUrl);
      return;
    }
    let objectUrl = '';
    let cancelled = false;
    (async () => {
      const res = await apiAuthFetch(`${getApiBaseUrl()}${slide.imageUrl}`);
      if (!res || !res.ok || cancelled) return;
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      if (!cancelled) setSrc(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [slide.hasImage, slide.imageUrl, slide.signedUrl, slide.pptSlideId]);

  if (!src) {
    return (
      <div
        className={`flex aspect-video items-center justify-center bg-slate-950 text-xs text-slate-500 ${className}`}
      >
        No still
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={slide.title || `Slide ${slide.slideIndex}`}
      className={`aspect-video w-full object-cover bg-black ${className}`}
    />
  );
}

function BindingFields({
  slide,
  cues,
  compact,
  onChange,
}: {
  slide: PptSlide;
  cues: ScheduleCueOption[];
  compact?: boolean;
  onChange: (next: PptBinding) => void;
}) {
  const labelClass = compact
    ? 'block text-[10px] font-semibold uppercase tracking-wide text-slate-500'
    : 'block text-[11px] font-semibold uppercase tracking-wide text-slate-400';
  const selectClass = compact
    ? 'mt-0.5 w-full min-w-[10rem] rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-white'
    : 'mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white';

  return (
    <>
      <label className={labelClass}>
        Cue
        <select
          className={selectClass}
          value={slide.binding.itemId ?? ''}
          onChange={(e) => {
            const itemId = e.target.value ? Number(e.target.value) : null;
            let action = slide.binding.action;
            if (!itemId && CUE_REQUIRED_ACTIONS.has(action)) action = 'none';
            else if (itemId && action === 'none') action = 'load_start';
            onChange({ itemId, action });
          }}
        >
          <option value="">Not mapped</option>
          {cues.map((cue) => (
            <option key={cue.id} value={cue.id}>
              {cue.label}
              {cue.segmentName ? ` — ${cue.segmentName}` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        When this slide is live
        <select
          className={selectClass}
          value={slide.binding.action}
          onChange={(e) => {
            const action = e.target.value as PptAction;
            if (CUE_REQUIRED_ACTIONS.has(action) && !slide.binding.itemId) return;
            onChange({ itemId: slide.binding.itemId, action });
          }}
        >
          {ACTION_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

const PowerPointPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId') || '';
  const eventName = searchParams.get('eventName') || 'Event';

  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<PptSession | null>(null);
  const [slides, setSlides] = useState<PptSlide[]>([]);
  const [cues, setCues] = useState<ScheduleCueOption[]>([]);
  const [retentionMonths, setRetentionMonths] = useState(1);
  const [view, setView] = useState<SlideView>(readSlideView);
  const [clockAuto, setClockAuto] = useState<boolean | null>(null);

  const setSlideView = useCallback((next: SlideView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const applyPayload = useCallback((data: any) => {
    if (!data) return;
    if (data.session) setSession(data.session as PptSession);
    if (Array.isArray(data.slides)) setSlides(data.slides as PptSlide[]);
    if (Number.isFinite(Number(data.retentionMonths))) {
      setRetentionMonths(Number(data.retentionMonths));
    }
  }, []);

  const loadDeck = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}`, {
        headers: apiJsonHeaders(),
      });
      if (res.status === 404) {
        throw new Error(
          'Railway API is still on the old build (GET /api/powerpoint returned 404). Redeploy ros-50-production from the Railway dashboard so the PowerPoint endpoints go live, then refresh this page.'
        );
      }
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      applyPayload(await res.json());
    } catch (e: any) {
      setError(e?.message || 'Failed to load PowerPoint stills');
    } finally {
      setLoading(false);
    }
  }, [applyPayload, eventId]);

  const loadCues = useCallback(async () => {
    if (!eventId) return;
    try {
      const data = await DatabaseService.getRunOfShowData(eventId);
      const items = Array.isArray(data?.schedule_items) ? data.schedule_items : [];
      const opts: ScheduleCueOption[] = items
        .map((item: any) => {
          const id = Number(item?.id);
          if (!Number.isFinite(id)) return null;
          const raw = item?.customFields?.cue ?? item?.custom_fields?.cue ?? '';
          const label = String(raw || '').trim()
            ? normalizeCueLabel(String(raw).trim())
            : `Item ${id}`;
          return {
            id,
            label,
            segmentName: String(item.segmentName || item.segment_name || ''),
          };
        })
        .filter(Boolean) as ScheduleCueOption[];
      setCues(opts);
    } catch {
      setCues([]);
    }
  }, [eventId]);

  useEffect(() => {
    void loadDeck();
    void loadCues();
  }, [loadDeck, loadCues]);

  useEffect(() => {
    if (!eventId) return;
    socketClient.connect(
      eventId,
      {
        onPptDeckUpdated: (data) => {
          if (data?.session || Array.isArray(data?.slides)) applyPayload(data);
        },
        onPptPlaybackStatus: (data) => {
          if (typeof data?.session?.clockAutoPush === 'boolean') {
            setClockAuto(data.session.clockAutoPush);
          }
        },
        onPptSlideLive: (data) => {
          if (!data) return;
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  connected: true,
                  slideshowActive: !!data.slideshowActive,
                  currentSlideId: data.pptSlideId ?? prev.currentSlideId,
                  currentIndex: data.slideIndex ?? prev.currentIndex,
                  lastSeen: new Date().toISOString(),
                  lastAction: data.fired ? data.action || prev.lastAction : prev.lastAction,
                  lastItemId: data.fired ? data.itemId ?? prev.lastItemId : prev.lastItemId,
                }
              : prev
          );
        },
      },
      'powerpoint-page'
    );
    return () => {
      socketClient.disconnect(eventId, 'powerpoint-page');
    };
  }, [applyPayload, eventId]);

  const saveBinding = useCallback(
    async (slide: PptSlide, next: PptBinding) => {
      if (!eventId) return;
      setSavingId(slide.pptSlideId);
      setSlides((prev) =>
        prev.map((s) => (s.pptSlideId === slide.pptSlideId ? { ...s, binding: next } : s))
      );
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/bindings`,
          {
            method: 'PUT',
            headers: apiJsonHeaders(),
            body: JSON.stringify({
              bindings: [
                {
                  pptSlideId: slide.pptSlideId,
                  itemId: next.itemId,
                  action: next.action,
                },
              ],
            }),
          }
        );
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        applyPayload(await res.json());
      } catch (e: any) {
        setError(e?.message || 'Failed to save mapping');
        void loadDeck();
      } finally {
        setSavingId(null);
      }
    },
    [applyPayload, eventId, loadDeck]
  );

  const clearStills = useCallback(async () => {
    if (!eventId || clearing) return;
    const ok = window.confirm(
      'Remove all captured stills for this event from Railway?\n\nCue mappings stay so recapturing the same deck can restore them.'
    );
    if (!ok) return;
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/stills`,
        {
          method: 'DELETE',
          headers: apiJsonHeaders(),
        }
      );
      if (!res.ok) throw new Error(`Clear failed (${res.status})`);
      applyPayload(await res.json());
    } catch (e: any) {
      setError(e?.message || 'Failed to clear stills');
      void loadDeck();
    } finally {
      setClearing(false);
    }
  }, [applyPayload, clearing, eventId, loadDeck]);

  const liveSlide = useMemo(
    () => slides.find((s) => s.pptSlideId === session?.currentSlideId) || null,
    [session?.currentSlideId, slides]
  );
  const pptClockFeed = useMemo(
    () => ({
      imageUrl: liveSlide?.hasImage ? liveSlide.signedUrl || liveSlide.imageUrl : '',
      liveCaptureUrl: '',
      liveCaptureActive: false,
      slideIndex: liveSlide?.slideIndex ?? session?.currentIndex ?? null,
      deckName: session?.deckName || '',
      itemId: liveSlide?.binding?.itemId ?? session?.lastItemId ?? null,
    }),
    [
      liveSlide?.binding?.itemId,
      liveSlide?.hasImage,
      liveSlide?.imageUrl,
      liveSlide?.signedUrl,
      liveSlide?.slideIndex,
      session?.currentIndex,
      session?.deckName,
      session?.lastItemId,
    ]
  );
  const pptCueRunning = !!(
    session?.connected &&
    session?.slideshowActive &&
    liveSlide &&
    (liveSlide.binding?.itemId != null || session.lastItemId != null)
  );
  const {
    clockFeedActive,
    autoPush,
    setAutoPushPref,
    pushToClock,
    clearClock,
    canPush,
  } = usePptClockPublisher(eventId, pptClockFeed, pptCueRunning, clockAuto);

  if (!eventId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
        Open PowerPoint from an event (missing eventId).
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-300">
        Loading PowerPoint stills…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-900/95 px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-white">PowerPoint Show with Timers</h1>
          <p className="truncate text-xs text-slate-400">
            {eventName}
            {session?.deckName ? ` · ${session.deckName}` : ''}
            {session?.slideCount ? ` · ${session.slideCount} slides` : ''}
            {` · stills auto-clear after ${retentionMonths} month${retentionMonths === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              session?.connected
                ? 'bg-emerald-800 text-emerald-100'
                : 'bg-slate-700 text-slate-300'
            }`}
          >
            {session?.connected ? 'Bridge connected' : 'Bridge offline'}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              session?.slideshowActive
                ? 'bg-amber-700 text-amber-50'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {session?.slideshowActive ? 'Slideshow live' : 'Not presenting'}
          </span>
          <span className="text-[11px] text-slate-500">
            Seen {formatLastSeen(session?.lastSeen || null)}
          </span>
          <PptClockFeedControls
            canPush={canPush}
            clockFeedActive={clockFeedActive}
            autoPush={autoPush}
            onAutoPushChange={setAutoPushPref}
            onPush={pushToClock}
            onClear={clearClock}
          />
          {slides.length > 0 ? (
            <div className="inline-flex overflow-hidden rounded border border-slate-600">
              <button
                type="button"
                onClick={() => setSlideView('grid')}
                className={`px-3 py-1.5 text-xs font-semibold ${
                  view === 'grid'
                    ? 'bg-slate-600 text-white'
                    : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
              >
                Grid
              </button>
              <button
                type="button"
                onClick={() => setSlideView('list')}
                className={`px-3 py-1.5 text-xs font-semibold ${
                  view === 'list'
                    ? 'bg-slate-600 text-white'
                    : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
              >
                List
              </button>
            </div>
          ) : null}
          {slides.length > 0 ? (
            <button
              type="button"
              disabled={clearing}
              onClick={() => void clearStills()}
              className="rounded border border-rose-700 bg-rose-950 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {clearing ? 'Clearing…' : 'Clear stills'}
            </button>
          ) : null}
          <a
            href={getAppDownloadUrl('powerpoint-bridge.zip')}
            className="rounded bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500"
          >
            Download Windows bridge
          </a>
          <Link
            to={`/run-of-show?eventId=${encodeURIComponent(eventId)}`}
            className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            Exit to Run of Show
          </Link>
        </div>
      </header>

      {error ? (
        <div className="mx-4 mt-3 rounded border border-rose-700 bg-rose-950/60 px-3 py-2 text-sm text-rose-100">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 rounded bg-rose-800 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700"
            onClick={() => {
              setLoading(true);
              void loadDeck();
            }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {liveSlide ? (
        <section className="mx-4 mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-amber-700/60 bg-slate-800/80 p-3">
          <div className="w-48 overflow-hidden rounded-lg border border-slate-600">
            <StillImage slide={liveSlide} />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-amber-300">
              Live slide
            </div>
            <div className="text-lg font-semibold text-white">
              Slide {liveSlide.slideIndex}
              {liveSlide.title ? ` — ${liveSlide.title}` : ''}
            </div>
            <div className="text-sm text-slate-300">
              {liveSlide.binding.action === 'none'
                ? 'No action'
                : `${ACTION_OPTIONS.find((a) => a.id === liveSlide.binding.action)?.label || liveSlide.binding.action}${
                    liveSlide.binding.itemId
                      ? ` · ${cues.find((c) => c.id === liveSlide.binding.itemId)?.label || `Item ${liveSlide.binding.itemId}`}`
                      : ''
                  }`}
            </div>
          </div>
        </section>
      ) : null}

      {slides.length === 0 ? (
        <div className="mx-4 mt-8 rounded-xl border border-dashed border-slate-600 bg-slate-800/40 px-6 py-12 text-center text-slate-300">
          <p className="text-lg font-semibold text-white">No stills yet</p>
          <p className="mt-2 text-sm">
            On the PowerPoint computer: download the Windows bridge, unzip, run START.bat, paste an
            integration token, pick this event, then Capture stills. Event ID:{' '}
            <code className="rounded bg-slate-900 px-1 text-orange-200">{eventId}</code>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Captured stills are removed from Railway automatically after {retentionMonths} month
            {retentionMonths === 1 ? '' : 's'}.
            Recapture to keep a current set.
          </p>
          <a
            href={getAppDownloadUrl('powerpoint-bridge.zip')}
            className="mt-4 inline-flex rounded bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500"
          >
            Download PowerPoint Bridge
          </a>
        </div>
      ) : view === 'list' ? (
        <div className="mx-4 my-4 overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
          {slides.map((slide) => {
            const isLive = session?.currentSlideId === slide.pptSlideId && !!session?.slideshowActive;
            return (
              <article
                key={slide.pptSlideId}
                className={`flex flex-wrap items-center gap-3 border-b border-slate-700 px-3 py-2 last:border-b-0 ${
                  isLive ? 'bg-amber-950/40' : ''
                }`}
              >
                <div className="w-28 shrink-0 overflow-hidden rounded border border-slate-600">
                  <StillImage slide={slide} />
                </div>
                <div className="min-w-[10rem] flex-1">
                  <div className="text-sm font-semibold text-white">
                    Slide {slide.slideIndex}
                    {isLive ? (
                      <span className="ml-2 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-950">
                        Live
                      </span>
                    ) : null}
                    {savingId === slide.pptSlideId ? (
                      <span className="ml-2 text-[10px] font-normal text-slate-400">Saving…</span>
                    ) : null}
                  </div>
                  <div className="truncate text-xs text-slate-400">{slide.title || 'Untitled'}</div>
                </div>
                <div className="flex min-w-[16rem] flex-1 flex-wrap gap-2">
                  <BindingFields
                    slide={slide}
                    cues={cues}
                    compact
                    onChange={(next) => void saveBinding(slide, next)}
                  />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {slides.map((slide) => {
            const isLive = session?.currentSlideId === slide.pptSlideId && !!session?.slideshowActive;
            return (
              <article
                key={slide.pptSlideId}
                className={`overflow-hidden rounded-xl border bg-slate-800 shadow ${
                  isLive ? 'border-amber-400 ring-2 ring-amber-400/40' : 'border-slate-700'
                }`}
              >
                <StillImage slide={slide} />
                <div className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">
                        Slide {slide.slideIndex}
                        {isLive ? (
                          <span className="ml-2 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-950">
                            Live
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-slate-400">
                        {slide.title || 'Untitled'}
                      </div>
                    </div>
                    {savingId === slide.pptSlideId ? (
                      <span className="text-[10px] text-slate-400">Saving…</span>
                    ) : null}
                  </div>
                  <BindingFields
                    slide={slide}
                    cues={cues}
                    onChange={(next) => void saveBinding(slide, next)}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PowerPointPage;
