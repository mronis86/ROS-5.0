import React, { useEffect, useState } from 'react';
import { getApiBaseUrl } from '../services/api-client';
import { apiAuthFetch } from '../lib/sessionAuth';
import {
  isPptVdoViewUrl,
  type PptClockFeed,
} from '../lib/pptClockFeed';

const stillCache = new Map<string, string>();

/**
 * 16:9 PowerPoint confidence feed for Clock / Fullscreen Timer.
 * Prefers the live VDO preview; falls back to the current still.
 */
export const PptClockOverlay: React.FC<{
  feed: PptClockFeed;
  className?: string;
}> = ({ feed, className = '' }) => {
  const liveUrl = isPptVdoViewUrl(feed.liveCaptureUrl) ? String(feed.liveCaptureUrl) : '';
  const showLive = !!feed.liveCaptureActive && !!liveUrl;
  const stillPath = String(feed.imageUrl || '').trim();
  const [stillSrc, setStillSrc] = useState(() => stillCache.get(stillPath) || '');

  useEffect(() => {
    if (showLive || !stillPath) {
      setStillSrc('');
      return;
    }
    const cached = stillCache.get(stillPath);
    if (cached) {
      setStillSrc(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      const url = stillPath.startsWith('http') ? stillPath : `${getApiBaseUrl()}${stillPath}`;
      const res = await apiAuthFetch(url);
      if (!res || !res.ok || cancelled) return;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      stillCache.set(stillPath, objectUrl);
      if (!cancelled) setStillSrc(objectUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [showLive, stillPath]);

  const slideLabel =
    feed.slideIndex != null ? `Slide ${feed.slideIndex}` : 'PowerPoint';

  return (
    <div className={`relative flex h-full w-full flex-col overflow-hidden bg-black ${className}`}>
      {showLive ? (
        <iframe
          title="Live PowerPoint preview"
          src={liveUrl}
          className="h-full w-full border-0 bg-black"
          allow="autoplay; fullscreen; camera; microphone; display-capture"
        />
      ) : stillSrc ? (
        <img
          src={stillSrc}
          alt={feed.deckName || slideLabel}
          className="h-full w-full object-contain bg-black"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-2xl text-slate-500">
          {slideLabel}
        </div>
      )}
      <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
        {showLive ? 'Live PPT' : 'PPT'}
        {feed.slideIndex != null ? ` · ${feed.slideIndex}` : ''}
      </div>
    </div>
  );
};

export default PptClockOverlay;
