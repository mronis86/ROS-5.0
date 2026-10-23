import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getApiBaseUrl, getAppDownloadUrl } from '../services/api-client';
import { apiAuthFetch, apiJsonHeaders } from '../lib/sessionAuth';
import { socketClient } from '../services/socket-client';
import { DatabaseService } from '../services/database';
import { normalizeCueLabel } from '../lib/cueCards';

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
};

type PreviewSlide = {
  pptSlideId: string;
  slideIndex: number;
  title: string;
  hasImage: boolean;
  imageUrl: string;
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

const HELPER_FRESH_MS = 20 * 1000;

function formatLastSeen(raw: string | null): string {
  if (!raw) return 'never';
  const ms = Date.now() - new Date(raw).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  if (ms < 4000) return 'just now';
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  return `${Math.round(ms / 60000)}m ago`;
}

function isFreshSeen(raw: string | null): boolean {
  if (!raw) return false;
  const ms = Date.now() - new Date(raw).getTime();
  return Number.isFinite(ms) && ms >= 0 && ms <= HELPER_FRESH_MS;
}

function PreviewImage({ slide, className = '' }: { slide: PreviewSlide; className?: string }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (!slide.hasImage) {
      setSrc('');
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
  }, [slide.hasImage, slide.imageUrl, slide.pptSlideId]);

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
  const [, setSeenTick] = useState(0);

  const applyPlayback = useCallback((data: any) => {
    if (data?.session) setSession(data.session as PlaybackSession);
    if (Array.isArray(data?.previews)) setPreviews(data.previews as PreviewSlide[]);
  }, []);

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
  }, [loadCues, loadStatus]);

  useEffect(() => {
    if (!eventId) return;
    const poll = window.setInterval(() => {
      void loadStatus();
    }, 1000);
    const seen = window.setInterval(() => setSeenTick((n) => n + 1), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(seen);
    };
  }, [eventId, loadStatus]);

  useEffect(() => {
    if (!eventId) return;
    socketClient.connect(
      eventId,
      {
        onPptPlaybackStatus: (data) => applyPlayback(data),
        onTimerUpdated: () => {
          void loadStatus();
          void loadCues();
        },
      },
      'powerpoint-playback-page'
    );
    return () => {
      socketClient.disconnect(eventId, 'powerpoint-playback-page');
    };
  }, [applyPlayback, eventId, loadCues, loadStatus]);

  const sendCommand = useCallback(
    async (action: string, slideIndex?: number) => {
      if (!eventId || sending) return;
      setSending(action);
      setError(null);
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/playback/command`,
          {
            method: 'POST',
            headers: apiJsonHeaders(),
            body: JSON.stringify({ action, slideIndex }),
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
                ? Number(slideIndex)
                : action === 'next'
                  ? current + 1
                  : current - 1;
            return {
              ...prev,
              currentIndex: count > 0 ? Math.min(count, Math.max(1, nextIndex)) : nextIndex,
            };
          });
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
    const itemId = fromSession?.itemId ?? session?.loadedItemId ?? session?.currentItemId ?? null;
    const scheduled = itemId != null ? cues.find((cue) => cue.id === itemId) : null;
    if (!itemId && !fromSession?.cueLabel) return null;
    return {
      itemId,
      label: fromSession?.cueLabel || scheduled?.label || (itemId != null ? `Item ${itemId}` : '—'),
      segmentName: fromSession?.segmentName || scheduled?.segmentName || '',
      timerState: fromSession?.timerState || null,
      hasPPT: fromSession?.hasPPT || scheduled?.hasPPT || false,
    };
  }, [cues, session]);

  const helperSeen = isFreshSeen(session?.lastSeen || null);
  const wrongMode = !session?.connected && helperSeen && session?.helperMode === 'follow';
  const bridgeLabel = session?.connected
    ? 'Bridge connected'
    : wrongMode
      ? 'Helper in Show with Timers'
      : 'Bridge offline';
  const preferred = assets.filter((a) => a.preferred);

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
            {session?.deckName ? ` · ${session.deckName}` : ''}
            {session?.slideCount || previews.length
              ? ` · ${session?.currentIndex || '—'} / ${session?.slideCount || previews.length} slides`
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
        <div className="text-[11px] font-bold uppercase tracking-wide text-orange-300">
          Current ROS cue
        </div>
        {currentCue ? (
          <>
            <div className="mt-1 text-2xl font-semibold text-white">{currentCue.label}</div>
            {currentCue.segmentName ? (
              <div className="mt-0.5 text-sm text-slate-300">{currentCue.segmentName}</div>
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
              ) : null}
            </div>
          </>
        ) : (
          <div className="mt-1 text-lg text-slate-400">No cue loaded on Run of Show yet.</div>
        )}
      </section>

      <section className="mx-4 mt-4 rounded-xl border border-slate-700 bg-slate-800/80 p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-orange-300">Live deck</div>
        <div className="mt-1 text-lg font-semibold text-white">
          {session?.deckName || 'No deck open'}
        </div>
        <div className="mt-2 text-3xl font-bold tabular-nums text-orange-200">
          {session?.currentIndex != null || session?.slideCount || previews.length
            ? `Slide ${session?.currentIndex || '—'} of ${session?.slideCount || previews.length || '—'}`
            : 'Waiting for deck'}
        </div>
        <div className="mt-1 text-sm text-slate-400">
          {session?.lastCommand ? session.lastCommand : 'Waiting for the helper to follow the loaded cue'}
        </div>
        {session?.lastError ? (
          <div className="mt-2 text-sm text-rose-300">{session.lastError}</div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-end gap-2">
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
          <button
            type="button"
            disabled={!!sending}
            onClick={() => void sendCommand('start')}
            className="rounded bg-emerald-800 px-3 py-2 text-sm font-semibold text-emerald-50 hover:bg-emerald-700 disabled:opacity-50"
          >
            Start slideshow
          </button>
          <button
            type="button"
            disabled={!!sending}
            onClick={() => void sendCommand('end')}
            className="rounded bg-rose-900 px-3 py-2 text-sm font-semibold text-rose-50 hover:bg-rose-800 disabled:opacity-50"
          >
            End slideshow
          </button>
        </div>

        {previews.length > 0 ? (
          <div className="mt-5">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Slide previews · {previews.length} slides
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {previews.map((slide) => {
                const isLive = session?.currentIndex === slide.slideIndex;
                return (
                  <button
                    key={slide.pptSlideId}
                    type="button"
                    disabled={!!sending}
                    onClick={() => void sendCommand('goto', slide.slideIndex)}
                    className={`overflow-hidden rounded-lg border text-left transition ${
                      isLive
                        ? 'border-orange-400 ring-2 ring-orange-400/70'
                        : 'border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    <PreviewImage slide={slide} />
                    <div className={`px-2 py-1.5 text-xs ${isLive ? 'bg-orange-950/70 text-orange-100' : 'bg-slate-900 text-slate-300'}`}>
                      <span className="font-semibold">Slide {slide.slideIndex}</span>
                      {slide.title ? <span className="ml-1 truncate text-slate-400">{slide.title}</span> : null}
                      {isLive ? <span className="ml-1 font-bold uppercase text-orange-300">Live</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : session?.connected && session?.deckName ? (
          <p className="mt-4 text-sm text-slate-400">
            Capturing slide previews after the deck opens…
          </p>
        ) : null}
      </section>

      <section className="mx-4 mt-4 rounded-xl border border-slate-700 bg-slate-800/50 p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Cached event decks
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Check PPT on the cue and upload a .ppt / .pptx in Assets. The Windows helper syncs those
          files before the show and opens the current version when that cue loads.
        </p>
        {preferred.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No PowerPoint files on this event yet.</p>
        ) : (
          <div className="mt-3 grid gap-2">
            {preferred.map((asset) => {
              const cue = asset.itemId != null ? cues.find((row) => row.id === asset.itemId) : null;
              const active = currentCue?.itemId != null && asset.itemId === currentCue.itemId;
              return (
                <div
                  key={asset.fileId}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm ${
                    active
                      ? 'border-orange-500 bg-orange-950/40'
                      : 'border-slate-700 bg-slate-900/70'
                  }`}
                >
                  <div>
                    <div className="font-semibold text-white">{asset.originalName}</div>
                    <div className="text-xs text-slate-400">
                      {cue?.label || `Cue ${asset.itemId}`}
                      {cue?.segmentName ? ` — ${cue.segmentName}` : ''}
                      {asset.hasPPT ? ' · PPT checked' : ' · PPT unchecked'}
                      {asset.sizeBytes != null ? ` · ${Math.round(asset.sizeBytes / 1024)} KB` : ''}
                    </div>
                  </div>
                  {active ? (
                    <span className="rounded-full bg-orange-700 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-orange-50">
                      Current cue
                    </span>
                  ) : null}
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
