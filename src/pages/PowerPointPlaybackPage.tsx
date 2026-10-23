import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getApiBaseUrl, getAppDownloadUrl } from '../services/api-client';
import { apiJsonHeaders } from '../lib/sessionAuth';
import { socketClient } from '../services/socket-client';

type PlaybackSession = {
  connected: boolean;
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
};

type ManifestAsset = {
  fileId: string;
  itemId: number | null;
  originalName: string;
  sizeBytes: number | null;
  hasPPT: boolean;
  preferred: boolean;
};

function formatLastSeen(raw: string | null): string {
  if (!raw) return 'never';
  const ms = Date.now() - new Date(raw).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  if (ms < 4000) return 'just now';
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  return `${Math.round(ms / 60000)}m ago`;
}

const PowerPointPlaybackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId') || '';
  const eventName = searchParams.get('eventName') || 'Event';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [assets, setAssets] = useState<ManifestAsset[]>([]);
  const [gotoValue, setGotoValue] = useState('');
  const [sending, setSending] = useState<string | null>(null);

  const applyPlayback = useCallback((data: any) => {
    if (data?.session) setSession(data.session as PlaybackSession);
  }, []);

  const loadStatus = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const [statusRes, manifestRes] = await Promise.all([
        fetch(`${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/playback`, {
          headers: apiJsonHeaders(),
        }),
        fetch(`${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/playback/manifest`, {
          headers: apiJsonHeaders(),
        }),
      ]);
      if (!statusRes.ok) throw new Error(`Status failed (${statusRes.status})`);
      applyPlayback(await statusRes.json());
      if (manifestRes.ok) {
        const manifest = await manifestRes.json();
        setAssets(Array.isArray(manifest?.assets) ? manifest.assets : []);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load playback status');
    } finally {
      setLoading(false);
    }
  }, [applyPlayback, eventId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!eventId) return;
    socketClient.connect(
      eventId,
      {
        onPptPlaybackStatus: (data) => applyPlayback(data),
        onTimerUpdated: () => {
          void loadStatus();
        },
      },
      'powerpoint-playback-page'
    );
    return () => {
      socketClient.disconnect(eventId, 'powerpoint-playback-page');
    };
  }, [applyPlayback, eventId, loadStatus]);

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
        applyPlayback(await res.json());
      } catch (e: any) {
        setError(e?.message || 'Failed to send command');
      } finally {
        setSending(null);
      }
    },
    [applyPlayback, eventId, sending]
  );

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

  const preferred = assets.filter((a) => a.preferred);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-900/95 px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-white">ROS PPT Launcher</h1>
          <p className="truncate text-xs text-slate-400">
            {eventName}
            {session?.deckName ? ` · ${session.deckName}` : ''}
            {session?.slideCount ? ` · ${session.slideCount} slides` : ''}
            {` · cache ${session?.cacheOk || 0}/${session?.cacheTotal || 0}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
              session?.connected ? 'bg-emerald-800 text-emerald-100' : 'bg-slate-700 text-slate-300'
            }`}
          >
            {session?.connected ? 'Bridge connected' : 'Bridge offline'}
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
            to={`/powerpoint?eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(eventName)}`}
            className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            PowerPoint Show with Timers
          </Link>
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

      <section className="mx-4 mt-4 rounded-xl border border-slate-700 bg-slate-800/80 p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-orange-300">Live deck</div>
        <div className="mt-1 text-lg font-semibold text-white">
          {session?.deckName || 'No deck open'}
          {session?.currentIndex != null ? ` · slide ${session.currentIndex}` : ''}
        </div>
        <div className="mt-1 text-sm text-slate-400">
          Loaded cue {session?.loadedItemId ?? '—'}
          {session?.currentItemId != null ? ` · open cue ${session.currentItemId}` : ''}
          {session?.lastCommand ? ` · ${session.lastCommand}` : ''}
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
            {preferred.map((asset) => (
              <div
                key={asset.fileId}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-semibold text-white">{asset.originalName}</div>
                  <div className="text-xs text-slate-400">
                    Cue {asset.itemId}
                    {asset.hasPPT ? ' · PPT checked' : ' · PPT unchecked'}
                    {asset.sizeBytes != null ? ` · ${Math.round(asset.sizeBytes / 1024)} KB` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default PowerPointPlaybackPage;
