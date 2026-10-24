import React, { useCallback, useEffect, useState } from 'react';
import { getApiBaseUrl } from '../services/api-client';
import { apiJsonHeaders } from '../lib/sessionAuth';
import { socketClient } from '../services/socket-client';

export type PptPendingDeckUpdate = {
  itemId: number;
  fileId: string;
  originalName: string;
  cueLabel: string;
  localFileId: string | null;
};

export async function pushPptPendingDeck(eventId: string, update: Pick<PptPendingDeckUpdate, 'itemId' | 'fileId'>) {
  const res = await fetch(`${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/playback/command`, {
    method: 'POST',
    headers: apiJsonHeaders(),
    body: JSON.stringify({
      action: 'sync',
      itemId: update.itemId,
      fileId: update.fileId,
    }),
  });
  if (!res.ok) throw new Error(`Push failed (${res.status})`);
  return res.json();
}

export function usePptPendingDecks(eventId: string, enabled = true) {
  const [pending, setPending] = useState<PptPendingDeckUpdate[]>([]);
  const [connected, setConnected] = useState(false);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyPayload = useCallback((data: any) => {
    if (!data) return;
    if (data.session) setConnected(!!data.session.connected);
    if (Array.isArray(data.pendingUpdates)) setPending(data.pendingUpdates as PptPendingDeckUpdate[]);
  }, []);

  const load = useCallback(async () => {
    if (!eventId || !enabled) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/powerpoint/${encodeURIComponent(eventId)}/playback`, {
        headers: apiJsonHeaders(),
      });
      if (!res.ok) return;
      applyPayload(await res.json());
    } catch {
      /* next poll */
    }
  }, [applyPayload, enabled, eventId]);

  useEffect(() => {
    if (!eventId || !enabled) {
      setPending([]);
      setConnected(false);
      return;
    }
    void load();
    const poll = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(poll);
  }, [enabled, eventId, load]);

  useEffect(() => {
    if (!eventId || !enabled) return;
    const key = `ppt-pending-decks-${eventId}`;
    socketClient.connect(
      eventId,
      {
        onPptPlaybackStatus: (data) => applyPayload(data),
        onPptPlaybackCommand: () => void load(),
        onPptDeckUpdated: () => void load(),
      },
      key
    );
    return () => {
      socketClient.disconnect(eventId, key);
    };
  }, [applyPayload, enabled, eventId, load]);

  const push = useCallback(
    async (update: PptPendingDeckUpdate) => {
      if (!eventId || pushingId) return;
      setPushingId(update.fileId);
      setError(null);
      try {
        applyPayload(await pushPptPendingDeck(eventId, update));
      } catch (e: any) {
        setError(e?.message || 'Failed to push deck');
      } finally {
        setPushingId(null);
        window.setTimeout(() => void load(), 1200);
      }
    },
    [applyPayload, eventId, load, pushingId]
  );

  return { pending, connected, push, pushingId, error };
}

export function OperatorPptPendingDecks({ eventId, className = 'mb-3' }: { eventId: string; className?: string }) {
  const { pending, connected, push, pushingId, error } = usePptPendingDecks(eventId, true);
  if (!connected) return null;
  return (
    <PptPendingDeckBanner
      className={className}
      pending={pending}
      onPush={(update) => void push(update)}
      pushingId={pushingId}
      error={error}
    />
  );
}

export default function PptPendingDeckBanner({
  pending,
  onPush,
  pushingId,
  error,
  className = '',
}: {
  pending: PptPendingDeckUpdate[];
  onPush: (update: PptPendingDeckUpdate) => void;
  pushingId?: string | null;
  error?: string | null;
  className?: string;
}) {
  if (!pending.length) return null;
  return (
    <div
      className={`rounded-lg border border-violet-500/70 bg-violet-950/80 px-3 py-2 text-sm text-violet-50 ${className}`}
    >
      <div className="text-[11px] font-bold uppercase tracking-wide text-violet-200">
        New PowerPoint ready
      </div>
      <p className="mt-0.5 text-xs text-violet-100/80">
        Push downloads the new file to the helper. The live deck stays as-is.
      </p>
      <div className="mt-2 flex flex-col gap-2">
        {pending.map((update) => (
          <div key={`${update.itemId}-${update.fileId}`} className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-white">{update.cueLabel}</div>
              <div className="truncate text-xs text-violet-100/80">{update.originalName}</div>
            </div>
            <button
              type="button"
              disabled={!!pushingId}
              onClick={() => onPush(update)}
              className="rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {pushingId === update.fileId ? 'Pushing…' : 'Push to helper'}
            </button>
          </div>
        ))}
      </div>
      {error ? <p className="mt-2 text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}
