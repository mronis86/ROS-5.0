import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getApiBaseUrl, getAppDownloadUrl } from '../services/api-client';
import { apiAuthFetch, apiJsonHeaders } from '../lib/sessionAuth';
import { socketClient } from '../services/socket-client';
import { DatabaseService } from '../services/database';
import { normalizeCueLabel } from '../lib/cueCards';
import PptPendingDeckBanner, { type PptPendingDeckUpdate } from '../components/PptPendingDeckBanner';
import PptClockFeedControls from '../components/PptClockFeedControls';
import { usePptClockPublisher } from '../hooks/usePptClockPublisher';
import { isPptVdoViewUrl } from '../lib/pptClockFeed';

type LoadedCue = {
  itemId: number | null;
  cueLabel: string;
  segmentName: string;
  timerState: 'loaded' | 'running' | null;
  hasPPT: boolean;
};

type PlaybackSession = {
  connected: boolean;
  helperMode?: 'follow' | 'playback' | '';
  lastSeen: string | null;
  deckName: string;
  slideCount: number;
  slideshowActive: boolean;
  currentIndex: number | null;
  currentItemId: number | null;
  currentFileId: string | null;
  cacheOk: number;
  cacheTotal: number;
  lastCommand: string | null;
  lastError: string | null;
  queuedCommand: { id?: string; action?: string; slideIndex?: number | null } | null;
  loadedItemId: number | null;
  loadedCue?: LoadedCue | null;
  liveCaptureUrl?: string;
  liveCaptureActive?: boolean;
  liveCaptureSource?: 'screen' | 'camera' | '';
  clockAutoPush?: boolean;
  cueFollowAuto?: boolean;
  livePath?: string;
  openMatch?: string;
  openStale?: boolean;
};

type PreviewSlide = {
  pptSlideId: string;
  slideIndex: number;
  title: string;
  hasImage: boolean;
  imageUrl: string;
  updatedAt?: string | null;
  fileId?: string | null;
};

type ManifestAsset = {
  fileId: string;
  itemId: number | null;
  originalName: string;
  sizeBytes: number | null;
  hasPPT: boolean;
  preferred: boolean;
};

type ScheduleCue = {
  id: number;
  label: string;
  segmentName: string;
  hasPPT: boolean;
};

type RosCue = {
  itemId: number;
  timerState: 'loaded' | 'running';
};

function rosCueFromTimer(data: any): RosCue | null {
  if (!data) return null;
  const raw = String(data.timer_state ?? data.timerState ?? '').toLowerCase();
  if (data.is_active === false || raw === 'stopped') return null;
  const itemId = Number(data.item_id ?? data.itemId);
  if (!Number.isFinite(itemId)) return null;
  if (data.is_running === true || raw === 'running') return { itemId, timerState: 'running' };
  if (raw === 'loaded' || data.is_active === true) return { itemId, timerState: 'loaded' };
  return null;
}

const HELPER_FRESH_MS = 20 * 1000;
const previewObjectUrls = new Map<string, string>();

function revokePreviewCache() {
  for (const url of previewObjectUrls.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
  previewObjectUrls.clear();
}

function stubSlide(index: number | null): PreviewSlide | null {
  if (index == null || !Number.isFinite(index) || index < 1) return null;
  return {
    pptSlideId: `stub-${index}`,
    slideIndex: index,
    title: '',
    hasImage: false,
    imageUrl: '',
  };
}

const CUE_FOLLOW_KEY = (eventId: string) => `ros-ppt-cue-follow:${eventId}`;

function readCueFollow(eventId: string): boolean | null {
  if (!eventId) return null;
  try {
    const raw = window.localStorage.getItem(CUE_FOLLOW_KEY(eventId));
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    /* ignore */
  }
  return null;
}

function writeCueFollow(eventId: string, on: boolean) {
  if (!eventId) return;
  try {
    window.localStorage.setItem(CUE_FOLLOW_KEY(eventId), on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function formatLastSeen(raw: string | null): string {
  if (!raw) return 'never';
  const ms = Date.now() - new Date(raw).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  if (ms < 4000) return 'just now';
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  return `${Math.round(ms / 60000)}m ago`;
}

function cueNumberFromLabel(label: string, itemId?: number | null): string {
  const text = String(label || '').trim();
  const match = text.match(/(\d+(?:\.\d+)?[A-Za-z]?)\s*$/) || text.match(/(\d+(?:\.\d+)?[A-Za-z]?)/);
  if (match) return match[1];
  if (itemId != null) return String(itemId);
  return '—';
}

function CueNumberMark({
  label,
  itemId,
  size = 'md',
  active = false,
}: {
  label: string;
  itemId?: number | null;
  size?: 'md' | 'xl';
  active?: boolean;
}) {
  const number = cueNumberFromLabel(label, itemId);
  const xl = size === 'xl';
  return (
    <div
      className={`flex shrink-0 flex-col items-center justify-center rounded-xl px-3 ${
        xl ? 'min-w-[9rem] py-3' : 'min-w-[6.75rem] py-2'
      } ${active ? 'bg-orange-600 text-white' : 'bg-slate-950 text-orange-100'}`}
    >
      <div
        className={`font-bold uppercase tracking-[0.22em] ${
          xl ? 'text-xs' : 'text-[10px]'
        } ${active ? 'text-orange-100' : 'text-orange-400'}`}
      >
        CUE
      </div>
      <div className={`font-black tabular-nums leading-none ${xl ? 'text-6xl' : 'text-4xl'}`}>
        {number}
      </div>
    </div>
  );
}

function isFreshSeen(raw: string | null): boolean {
  if (!raw) return false;
  const ms = Date.now() - new Date(raw).getTime();
  return Number.isFinite(ms) && ms >= 0 && ms <= HELPER_FRESH_MS;
}

function PreviewImage({ slide, className = '' }: { slide: PreviewSlide; className?: string }) {
  const cacheKey = `${slide.imageUrl}|${slide.updatedAt || ''}`;
  const [src, setSrc] = useState(() => previewObjectUrls.get(cacheKey) || '');

  useEffect(() => {
    if (!slide.hasImage || !slide.imageUrl) {
      setSrc('');
      return;
    }
    const cached = previewObjectUrls.get(cacheKey);
    if (cached) {
      setSrc(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await apiAuthFetch(`${getApiBaseUrl()}${slide.imageUrl}`);
      if (!res || !res.ok || cancelled) return;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const previous = previewObjectUrls.get(cacheKey);
      previewObjectUrls.set(cacheKey, objectUrl);
      if (previous && previous !== objectUrl) {
        try {
          URL.revokeObjectURL(previous);
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setSrc(objectUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, slide.hasImage, slide.imageUrl]);

  if (!src) {
    return (
      <div className={`flex aspect-video items-center justify-center bg-slate-950 text-xs text-slate-500 ${className}`}>
        Slide {slide.slideIndex}
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

function cueFromItem(item: any): ScheduleCue | null {
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
    hasPPT: !!(item.hasPPT ?? item.has_ppt),
  };
}

const PowerPointPlaybackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId') || '';
  const eventName = searchParams.get('eventName') || 'Event';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [assets, setAssets] = useState<ManifestAsset[]>([]);
  const [cues, setCues] = useState<ScheduleCue[]>([]);
  const [gotoValue, setGotoValue] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [previews, setPreviews] = useState<PreviewSlide[]>([]);
  const [rosCue, setRosCue] = useState<RosCue | null>(null);
  const [pendingUpdates, setPendingUpdates] = useState<PptPendingDeckUpdate[]>([]);
  const [clearing, setClearing] = useState(false);
  const [, setSeenTick] = useState(0);
  const cueFollowWriteRef = useRef<{ value: boolean; at: number } | null>(null);

  const applyPlayback = useCallback((data: any) => {
    if (data?.session) {
      setSession((prev) => {
        const next = { ...(data.session as PlaybackSession) };
        const pending = cueFollowWriteRef.current;
        if (typeof next.cueFollowAuto !== 'boolean') {
          const stored = readCueFollow(eventId);
          next.cueFollowAuto =
            pending?.value ??
            (typeof prev?.cueFollowAuto === 'boolean' ? prev.cueFollowAuto : stored != null ? stored : true);
        } else if (pending && Date.now() - pending.at < 60000 && next.cueFollowAuto !== pending.value) {
          next.cueFollowAuto = pending.value;
        } else {
          writeCueFollow(eventId, next.cueFollowAuto);
          if (pending && next.cueFollowAuto === pending.value) cueFollowWriteRef.current = null;
        }
        if (
          prev?.currentFileId &&
          next.currentFileId &&
          prev.currentFileId !== next.currentFileId
        ) {
          revokePreviewCache();
        }
        return next;
      });
    }
    if (Array.isArray(data?.previews)) {
      const fileId = data?.session?.currentFileId ? String(data.session.currentFileId) : '';
      setPreviews(
        fileId
          ? (data.previews as PreviewSlide[]).filter((row) => !row.fileId || row.fileId === fileId)
          : []
      );
    }
    if (Array.isArray(data?.pendingUpdates)) setPendingUpdates(data.pendingUpdates as PptPendingDeckUpdate[]);
  }, [eventId]);

  const loadCues = useCallback(async () => {
    if (!eventId) return;
    try {
      const data = await DatabaseService.getRunOfShowData(eventId);
      const items = Array.isArray(data?.schedule_items) ? data.schedule_items : [];
      setCues(items.map(cueFromItem).filter(Boolean) as ScheduleCue[]);
    } catch {
      setCues([]);
    }
  }, [eventId]);

  const loadRosCue = useCallback(async () => {
    if (!eventId) return;
    try {
      const timer = await DatabaseService.getActiveTimer(eventId);
      setRosCue(rosCueFromTimer(timer));
    } catch {
      setRosCue(null);
    }
  }, [eventId]);

  const loadStatus = useCallback(async (withManifest = false) => {
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    try {
      const fetches: Promise<Response>[] = [
        fetch(`${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/playback`, {
          headers: apiJsonHeaders(),
        }),
      ];
      if (withManifest) {
        fetches.push(
          fetch(`${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/playback/manifest`, {
            headers: apiJsonHeaders(),
          })
        );
      }
      const [statusRes, manifestRes] = await Promise.all(fetches);
      if (!statusRes.ok) throw new Error(`Status failed (${statusRes.status})`);
      applyPlayback(await statusRes.json());
      if (manifestRes?.ok) {
        const manifest = await manifestRes.json();
        setAssets(Array.isArray(manifest?.assets) ? manifest.assets : []);
      }
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load playback status');
    } finally {
      setLoading(false);
    }
  }, [applyPlayback, eventId]);

  useEffect(() => {
    void loadStatus(true);
    void loadCues();
    void loadRosCue();
  }, [loadCues, loadRosCue, loadStatus]);

  useEffect(() => {
    if (!eventId) return;
    const poll = window.setInterval(() => {
      void loadStatus();
      void loadRosCue();
    }, 1000);
    const seen = window.setInterval(() => setSeenTick((n) => n + 1), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(seen);
    };
  }, [eventId, loadRosCue, loadStatus]);

  useEffect(() => {
    if (!eventId) return;
    socketClient.connect(
      eventId,
      {
        onPptPlaybackStatus: (data) => applyPlayback(data),
        onTimerUpdated: (data) => {
          setRosCue(rosCueFromTimer(data));
          void loadStatus();
          void loadCues();
        },
        onActiveTimersUpdated: (data) => {
          setRosCue(rosCueFromTimer(data));
          void loadStatus();
        },
        onTimerStopped: () => setRosCue(null),
        onTimersStopped: () => setRosCue(null),
      },
      'powerpoint-playback-page'
    );
    return () => {
      socketClient.disconnect(eventId, 'powerpoint-playback-page');
    };
  }, [applyPlayback, eventId, loadCues, loadStatus]);

  const sendCommand = useCallback(
    async (
      action: string,
      extra?: number | { slideIndex?: number; itemId?: number | null; fileId?: string }
    ) => {
      if (!eventId || sending) return;
      const opts = typeof extra === 'number' ? { slideIndex: extra } : extra || {};
      setSending(
        action === 'open' && opts.fileId
          ? `open:${opts.fileId}`
          : action === 'sync' && opts.fileId
            ? `sync:${opts.fileId}`
            : action
      );
      setError(null);
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/playback/command`,
          {
            method: 'POST',
            headers: apiJsonHeaders(),
            body: JSON.stringify({
              action,
              slideIndex: opts.slideIndex,
              itemId: opts.itemId,
              fileId: opts.fileId,
            }),
          }
        );
        if (!res.ok) throw new Error(`Command failed (${res.status})`);
        if (action === 'next' || action === 'prev' || action === 'goto') {
          setSession((prev) => {
            if (!prev) return prev;
            const count = prev.slideCount || previews.length || 0;
            const current = prev.currentIndex || 1;
            const nextIndex =
              action === 'goto'
                ? Number(opts.slideIndex)
                : action === 'next'
                  ? current + 1
                  : current - 1;
            return {
              ...prev,
              currentIndex: count > 0 ? Math.min(count, Math.max(1, nextIndex)) : nextIndex,
            };
          });
        }
        if (action === 'end') {
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  slideshowActive: false,
                  deckName: '',
                  currentIndex: null,
                  slideCount: 0,
                  currentItemId: null,
                  currentFileId: null,
                }
              : prev
          );
        }
        applyPlayback(await res.json());
      } catch (e: any) {
        setError(e?.message || 'Failed to send command');
      } finally {
        setSending(null);
      }
    },
    [applyPlayback, eventId, previews.length, sending]
  );

  const currentCue = useMemo(() => {
    const fromSession = session?.loadedCue;
    const sessionLive = fromSession?.timerState === 'loaded' || fromSession?.timerState === 'running'
      ? fromSession
      : null;
    const itemId = rosCue?.itemId ?? sessionLive?.itemId ?? null;
    const timerState = rosCue?.timerState ?? sessionLive?.timerState ?? null;
    if (itemId == null || !timerState) return null;
    const scheduled = cues.find((cue) => cue.id === itemId) || null;
    return {
      itemId,
      label: (sessionLive?.itemId === itemId ? sessionLive.cueLabel : '') || scheduled?.label || `Item ${itemId}`,
      segmentName:
        (sessionLive?.itemId === itemId ? sessionLive.segmentName : '') || scheduled?.segmentName || '',
      timerState,
      hasPPT: (sessionLive?.itemId === itemId && sessionLive.hasPPT) || scheduled?.hasPPT || false,
    };
  }, [cues, rosCue, session]);

  const deckOpen = !!(session?.connected && String(session.deckName || '').trim());
  const openCue =
    session?.currentItemId != null
      ? cues.find((row) => row.id === session.currentItemId) || null
      : null;
  const openMismatch =
    deckOpen &&
    currentCue?.itemId != null &&
    session?.currentItemId != null &&
    session.currentItemId !== currentCue.itemId;
  const openUnknown = deckOpen && session?.openMatch === 'unknown';
  const openStale = deckOpen && (!!session?.openStale || session?.openMatch === 'stale');
  const liveIndex =
    deckOpen && session?.currentIndex != null && session.currentIndex > 0 ? session.currentIndex : null;
  const currentSlide = deckOpen
    ? (liveIndex != null ? previews.find((slide) => slide.slideIndex === liveIndex) : null) || stubSlide(liveIndex)
    : null;
  const nextSlide = deckOpen
    ? (liveIndex != null ? previews.find((slide) => slide.slideIndex === liveIndex + 1) : null) ||
      stubSlide(liveIndex != null && session?.slideCount && liveIndex < session.slideCount ? liveIndex + 1 : null)
    : null;

  const pptClockFeed = useMemo(
    () => ({
      imageUrl: currentSlide?.hasImage ? currentSlide.imageUrl : '',
      liveCaptureUrl: session?.liveCaptureUrl || '',
      liveCaptureActive: !!session?.liveCaptureActive,
      slideIndex: liveIndex,
      deckName: session?.deckName || '',
      itemId: currentCue?.itemId ?? null,
    }),
    [
      currentCue?.itemId,
      currentSlide?.hasImage,
      currentSlide?.imageUrl,
      liveIndex,
      session?.deckName,
      session?.liveCaptureActive,
      session?.liveCaptureUrl,
    ]
  );
  const pptCueRunning = !!(
    session?.connected &&
    currentCue?.hasPPT &&
    (currentCue.timerState === 'loaded' || currentCue.timerState === 'running')
  );
  const {
    clockFeedActive,
    autoPush,
    setAutoPushPref,
    pushToClock,
    clearClock,
    canPush,
  } = usePptClockPublisher(eventId, pptClockFeed, pptCueRunning, session?.clockAutoPush);

  const clearImages = useCallback(async () => {
    if (!eventId || clearing) return;
    const ok = window.confirm(
      'Remove captured slide images for this event?\n\nThe helper will keep decks in the sync folder. Opening a deck again recaptures thumbnails.'
    );
    if (!ok) return;
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/playback/previews`,
        {
          method: 'DELETE',
          headers: apiJsonHeaders(),
        }
      );
      if (!res.ok) throw new Error(`Clear failed (${res.status})`);
      revokePreviewCache();
      applyPlayback(await res.json());
      await fetch(
        `${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/playback/command`,
        {
          method: 'POST',
          headers: apiJsonHeaders(),
          body: JSON.stringify({
            action: 'clear-previews',
            fileId: session?.currentFileId || undefined,
          }),
        }
      );
    } catch (e: any) {
      setError(e?.message || 'Failed to clear slide images');
    } finally {
      setClearing(false);
    }
  }, [applyPlayback, clearing, eventId, session?.currentFileId]);

  const setCueFollow = useCallback(
    async (on: boolean) => {
      if (!eventId) return;
      writeCueFollow(eventId, on);
      cueFollowWriteRef.current = { value: on, at: Date.now() };
      setSession((prev) => (prev ? { ...prev, cueFollowAuto: on } : prev));
      setError(null);
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/playback/cue-follow`,
          {
            method: 'POST',
            headers: apiJsonHeaders(),
            body: JSON.stringify({ enabled: on }),
          }
        );
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        applyPlayback(await res.json());
        if (on) {
          await fetch(
            `${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/playback/command`,
            {
              method: 'POST',
              headers: apiJsonHeaders(),
              body: JSON.stringify({ action: 'resume' }),
            }
          );
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to save open mode');
      }
    },
    [applyPlayback, eventId]
  );

  const helperSeen = isFreshSeen(session?.lastSeen || null);
  const wrongMode = !session?.connected && helperSeen && session?.helperMode === 'follow';
  const bridgeLabel = session?.connected
    ? 'Bridge connected'
    : wrongMode
      ? 'Helper in Show with Timers'
      : 'Bridge offline';
  const cueFollowAuto = session?.cueFollowAuto !== false;
  const cueOrder = new Map(cues.map((row, index) => [row.id, index]));
  const preferred = [...assets.filter((a) => a.preferred)].sort((a, b) => {
    const ia =
      a.itemId != null && cueOrder.has(a.itemId) ? cueOrder.get(a.itemId)! : Number.POSITIVE_INFINITY;
    const ib =
      b.itemId != null && cueOrder.has(b.itemId) ? cueOrder.get(b.itemId)! : Number.POSITIVE_INFINITY;
    if (ia !== ib) return ia - ib;
    return (a.itemId ?? 0) - (b.itemId ?? 0);
  });

  if (!eventId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
        Open ROS PPT Launcher from an event (missing eventId).
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-300">
        Loading PowerPoint playback…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-900/95 px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-white">ROS PPT Launcher</h1>
          <p className="truncate text-xs text-slate-400">
            {eventName}
            {deckOpen && session?.deckName ? ` · ${session.deckName}` : ''}
            {deckOpen && (session?.slideCount || session?.currentIndex)
              ? ` · ${session?.currentIndex || '—'} / ${session?.slideCount || '—'} slides`
              : ''}
            {` · cache ${session?.cacheOk || 0}/${session?.cacheTotal || 0}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              session?.connected
                ? 'bg-emerald-800 text-emerald-100'
                : wrongMode
                  ? 'bg-amber-800 text-amber-50'
                  : 'bg-slate-700 text-slate-300'
            }`}
          >
            {bridgeLabel}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              session?.slideshowActive ? 'bg-amber-700 text-amber-50' : 'bg-slate-800 text-slate-400'
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
          {previews.length > 0 || session?.currentFileId ? (
            <button
              type="button"
              disabled={clearing}
              onClick={() => void clearImages()}
              className="rounded border border-rose-700 bg-rose-950 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {clearing ? 'Clearing…' : 'Clear images'}
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
          {error}
        </div>
      ) : null}

      <PptPendingDeckBanner
        className="mx-4 mt-3"
        pending={pendingUpdates}
        pushingId={sending && sending.startsWith('sync:') ? sending.slice(5) : null}
        onPush={(update) => void sendCommand('sync', { itemId: update.itemId, fileId: update.fileId })}
      />

      {!session?.connected ? (
        <div className="mx-4 mt-3 rounded border border-amber-800/70 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          {wrongMode ? (
            <>
              The Windows helper is running <strong>PowerPoint Show with Timers</strong> on this
              event. On the helper, switch Mode to <strong>ROS PPT Launcher</strong>, then click{' '}
              <strong>Follow loaded cue</strong>.
            </>
          ) : (
            <>
              This page only sees the helper in <strong>ROS PPT Launcher</strong> mode. Open PowerPoint
              Bridge, pick this event, choose <strong>ROS PPT Launcher</strong> (not Show with Timers),
              then <strong>Follow loaded cue</strong>.
            </>
          )}
        </div>
      ) : null}

      <section className="mx-4 mt-4 rounded-xl border border-orange-800/60 bg-slate-800/80 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-orange-300">
            Current ROS cue
          </div>
          <div className="flex rounded-lg border border-slate-600 bg-slate-950 p-0.5">
            <button
              type="button"
              onClick={() => void setCueFollow(true)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                cueFollowAuto ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
              title="Helper opens the matching deck when a PPT cue is loaded"
            >
              Follow loaded cue
            </button>
            <button
              type="button"
              onClick={() => void setCueFollow(false)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                !cueFollowAuto ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
              title="Decks only open when you click Open & start in Synced decks"
            >
              Manual open
            </button>
          </div>
        </div>
        {currentCue ? (
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <CueNumberMark
              label={currentCue.label}
              itemId={currentCue.itemId}
              size="xl"
              active
            />
            <div className="min-w-0">
              <div className="text-xl font-semibold text-white">
                {currentCue.segmentName || currentCue.label}
              </div>
              {currentCue.segmentName ? (
                <div className="mt-0.5 text-sm text-slate-300">{currentCue.label}</div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide ${
                    currentCue.timerState === 'running'
                      ? 'bg-emerald-800 text-emerald-50'
                      : currentCue.timerState === 'loaded'
                        ? 'bg-sky-800 text-sky-50'
                        : 'bg-slate-700 text-slate-200'
                  }`}
                >
                  {currentCue.timerState === 'running'
                    ? 'Running'
                    : currentCue.timerState === 'loaded'
                      ? 'Loaded'
                      : 'On clock'}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide ${
                    currentCue.hasPPT ? 'bg-orange-800 text-orange-50' : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {currentCue.hasPPT ? 'PPT cue' : 'No PPT'}
                </span>
                {session?.currentItemId != null && session.currentItemId === currentCue.itemId ? (
                  <span className="rounded-full bg-slate-700 px-2 py-0.5 font-semibold uppercase tracking-wide text-slate-100">
                    Deck open
                  </span>
                ) : deckOpen ? (
                  <span className="rounded-full bg-amber-800 px-2 py-0.5 font-semibold uppercase tracking-wide text-amber-50">
                    Helper on a different deck
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-sm text-slate-400">
                {cueFollowAuto
                  ? 'Helper opens this deck when the cue loads.'
                  : 'Open the matching deck from Synced decks when you are ready.'}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 text-lg text-slate-400">No cue loaded on Run of Show yet.</div>
        )}
      </section>

      <section className="mx-4 mt-4 rounded-xl border border-slate-700 bg-slate-800/80 p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-orange-300">Live deck</div>
        <div className="mt-1 text-lg font-semibold text-white">
          {deckOpen ? session?.deckName : 'No deck open'}
        </div>
        {deckOpen ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {openUnknown ? (
              <span className="rounded-full bg-rose-800 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-rose-50">
                Not in sync folder
              </span>
            ) : openCue ? (
              <span className="rounded-full bg-sky-700 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-sky-50">
                Open · {openCue.label}
              </span>
            ) : null}
            {openMismatch ? (
              <span className="rounded-full bg-amber-700 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-50">
                Not the loaded cue
              </span>
            ) : null}
            {openStale ? (
              <span className="rounded-full bg-violet-700 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-violet-50">
                Older copy
              </span>
            ) : null}
          </div>
        ) : null}
        {openUnknown ? (
          <div className="mt-2 text-sm text-rose-200">
            PowerPoint has {session?.deckName || 'a file'} open that is not in this event’s sync folder.
          </div>
        ) : openMismatch && openCue ? (
          <div className="mt-2 text-sm text-amber-100">
            Helper is showing {openCue.label}
            {openCue.segmentName ? ` · ${openCue.segmentName}` : ''}. Loaded ROS cue is {currentCue?.label}.
          </div>
        ) : openStale ? (
          <div className="mt-2 text-sm text-violet-100">
            This is an older copy of the synced deck. Push the new file from Synced decks.
          </div>
        ) : null}
        <div className="mt-2 text-3xl font-bold tabular-nums text-orange-200">
          {deckOpen && (session?.currentIndex != null || session?.slideCount)
            ? `Slide ${session?.currentIndex || '—'} of ${session?.slideCount || '—'}`
            : 'Waiting for deck'}
        </div>
        <div className="mt-1 text-sm text-slate-400">
          {session?.lastCommand
            ? session.lastCommand
            : cueFollowAuto
              ? 'Waiting for the helper to follow the loaded cue'
              : 'Manual open — click Open & start on a synced deck'}
        </div>
        {session?.lastError ? (
          <div className="mt-2 text-sm text-rose-300">{session.lastError}</div>
        ) : null}

        {session?.liveCaptureActive && isPptVdoViewUrl(session.liveCaptureUrl) ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-500/40 bg-violet-950/40 px-3 py-1.5">
            <div className="text-xs font-semibold text-violet-100">
              Live capture is on
              {session.liveCaptureSource === 'camera' ? ' · camera' : ' · screen'}
            </div>
            <button
              type="button"
              onClick={() => {
                window.open(
                  session.liveCaptureUrl,
                  'ros-live-capture',
                  'popup=yes,width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes'
                );
              }}
              className="rounded bg-violet-700 px-3 py-1 text-xs font-semibold text-violet-50 hover:bg-violet-600"
            >
              Pop out
            </button>
          </div>
        ) : null}

        {cueFollowAuto && /paused|Manual deck/i.test(session?.lastCommand || '') ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-800/70 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
            <span>Cue auto-open is paused so this manual deck can stay up.</span>
            <button
              type="button"
              disabled={!!sending}
              onClick={() => void sendCommand('resume')}
              className="rounded bg-amber-800 px-3 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-700 disabled:opacity-50"
            >
              Resume cue follow
            </button>
          </div>
        ) : null}

        <div className="mt-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Slide navigation</div>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <button
              type="button"
              disabled={!!sending}
              onClick={() => void sendCommand('prev')}
              className="rounded bg-slate-700 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-600 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!!sending}
              onClick={() => void sendCommand('next')}
              className="rounded bg-slate-700 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-600 disabled:opacity-50"
            >
              Next
            </button>
            <label className="text-xs text-slate-400">
              Go to
              <span className="mt-1 flex gap-1">
                <input
                  type="number"
                  min={1}
                  value={gotoValue}
                  onChange={(e) => setGotoValue(e.target.value)}
                  className="w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white"
                />
                <button
                  type="button"
                  disabled={!!sending || !gotoValue}
                  onClick={() => void sendCommand('goto', Number(gotoValue))}
                  className="rounded bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-600 disabled:opacity-50"
                >
                  Go
                </button>
              </span>
            </label>
          </div>
        </div>

        {deckOpen && (currentSlide || nextSlide || previews.length > 0) ? (
          <div className="mx-auto mt-5 w-full max-w-[66rem]">
            <div className="mb-2 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Slide previews
              {session?.slideCount || previews.length
                ? ` · ${session?.slideCount || previews.length} slides`
                : ''}
            </div>
            <div className="flex flex-wrap items-start justify-center gap-6">
              {[
                { slide: currentSlide, label: 'Current', live: true, widthClass: 'w-full max-w-[36rem]' },
                { slide: nextSlide, label: 'Next', live: false, widthClass: 'w-full max-w-[28rem]' },
              ].map(({ slide, label, live, widthClass }) => (
                <button
                  key={label}
                  type="button"
                  disabled={!!sending || !slide}
                  onClick={() => slide && void sendCommand('goto', slide.slideIndex)}
                  className={`${widthClass} overflow-hidden rounded-xl border text-left ${
                    live
                      ? 'border-orange-400 ring-2 ring-orange-400/60'
                      : 'border-slate-700 hover:border-slate-500'
                  } disabled:opacity-60`}
                >
                  <div
                    className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide ${
                      live ? 'bg-orange-950/80 text-orange-200' : 'bg-slate-900 text-slate-400'
                    }`}
                  >
                    {label}
                    {slide ? ` · Slide ${slide.slideIndex}` : ''}
                  </div>
                  {slide ? (
                    <PreviewImage slide={slide} />
                  ) : (
                    <div className="flex aspect-video items-center justify-center bg-slate-950 text-sm text-slate-500">
                      {live ? 'No live slide' : 'Last slide'}
                    </div>
                  )}
                  {slide?.title ? (
                    <div className="truncate px-3 py-1.5 text-xs text-slate-300">{slide.title}</div>
                  ) : null}
                </button>
              ))}
            </div>
            {previews.length > 0 ? (
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/70">
                <div className="ppt-preview-strip overflow-x-auto px-3 pb-2 pt-3">
                  <div className="mx-auto flex w-max gap-2">
                    {previews.map((slide) => {
                      const isLive = liveIndex === slide.slideIndex;
                      const isNext = liveIndex != null && slide.slideIndex === liveIndex + 1;
                      return (
                        <button
                          key={slide.pptSlideId}
                          type="button"
                          disabled={!!sending}
                          onClick={() => void sendCommand('goto', slide.slideIndex)}
                          className={`w-24 shrink-0 overflow-hidden rounded-lg border text-left ${
                            isLive
                              ? 'border-orange-400 ring-1 ring-orange-400/70'
                              : isNext
                                ? 'border-sky-600'
                                : 'border-slate-700 hover:border-slate-500'
                          }`}
                        >
                          <PreviewImage slide={slide} />
                          <div
                            className={`px-1.5 py-1 text-[10px] font-semibold ${
                              isLive ? 'bg-orange-950/80 text-orange-100' : 'bg-slate-900 text-slate-300'
                            }`}
                          >
                            {slide.slideIndex}
                            {isLive ? ' · Live' : isNext ? ' · Next' : ''}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : deckOpen ? (
              <p className="mt-3 text-xs text-slate-500">
                Loading slide thumbnails… the helper caches them in the sync folder so the next switch is instant.
              </p>
            ) : null}
          </div>
        ) : deckOpen ? (
          <p className="mt-4 text-sm text-slate-400">
            Loading slide thumbnails… the helper caches them in the sync folder so the next switch is instant.
          </p>
        ) : null}
      </section>

      <section className="mx-4 mt-4 flex justify-center">
        <div className="w-full max-w-[66rem] rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Show control</div>
          <div className="mt-1.5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              disabled={!!sending}
              onClick={() => void sendCommand('start')}
              className="rounded bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-emerald-50 hover:bg-emerald-700 disabled:opacity-50"
            >
              Start slideshow
            </button>
            <button
              type="button"
              disabled={!!sending}
              onClick={() => void sendCommand('end')}
              className="rounded bg-rose-900 px-3 py-1.5 text-xs font-semibold text-rose-50 hover:bg-rose-800 disabled:opacity-50"
            >
              End slideshow & close PowerPoint
            </button>
          </div>
        </div>
      </section>

      <section className="mx-4 mt-4 rounded-xl border border-slate-700 bg-slate-800/50 p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-300">
          Synced decks · {cueFollowAuto ? 'follow loaded cue, or open anytime' : 'open from here'}
        </div>
        <p className="mt-1 text-sm text-slate-300">
          {cueFollowAuto
            ? 'Loaded PPT cues open themselves. Use Open & start to jump to another deck.'
            : 'Decks stay closed until you Open & start one. The loaded cue is highlighted so you can see where you are.'}
        </p>
        {preferred.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No PowerPoint files on this event yet.</p>
        ) : (
          <div className="mt-3 grid gap-2">
            {preferred.map((asset) => {
              const cue = asset.itemId != null ? cues.find((row) => row.id === asset.itemId) : null;
              const cueLabel = cue?.label || `CUE ${asset.itemId}`;
              const active = currentCue?.itemId != null && asset.itemId === currentCue.itemId;
              const open = session?.currentItemId != null && asset.itemId === session.currentItemId;
              const pending = pendingUpdates.find((row) => row.itemId === asset.itemId) || null;
              return (
                <div
                  key={asset.fileId}
                  className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${
                    active
                      ? 'border-orange-400 bg-orange-950/50 ring-2 ring-orange-400/40'
                      : open
                        ? 'border-sky-600 bg-slate-900/80'
                        : 'border-slate-600 bg-slate-900/80'
                  }`}
                >
                  <CueNumberMark label={cueLabel} itemId={asset.itemId} active={active} />
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-bold leading-tight text-white">
                      {cue?.segmentName || cueLabel}
                    </div>
                    <div className="mt-0.5 truncate text-sm text-slate-200">
                      {asset.originalName}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {asset.hasPPT ? 'PPT checked' : 'PPT unchecked'}
                      {asset.sizeBytes != null ? ` · ${Math.round(asset.sizeBytes / 1024)} KB` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {active ? (
                      <span className="rounded-full bg-orange-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                        Loaded cue
                      </span>
                    ) : null}
                    {open ? (
                      <span className="rounded-full bg-sky-700 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-sky-50">
                        Open now
                      </span>
                    ) : null}
                    {pending ? (
                      <>
                        <span className="rounded-full bg-violet-700 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-violet-50">
                          New deck
                        </span>
                        <button
                          type="button"
                          disabled={!!sending}
                          onClick={() =>
                            void sendCommand('sync', { itemId: pending.itemId, fileId: pending.fileId })
                          }
                          className="rounded bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                        >
                          {sending === `sync:${pending.fileId}` ? 'Pushing…' : 'Push to helper'}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      disabled={!!sending}
                      onClick={() =>
                        void sendCommand('open', { itemId: asset.itemId, fileId: asset.fileId })
                      }
                      className="rounded bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                    >
                      {sending === `open:${asset.fileId}` ? 'Opening…' : 'Open & start'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default PowerPointPlaybackPage;
