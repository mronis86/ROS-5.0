import React, { useState } from 'react';
import type { EventStreamDetails } from '../types/Event';
import { eventHasStreamRequestInfo } from '../types/Event';
import { createStreamRequestLink } from '../lib/streamRequestLinks';

type Props = {
  value: EventStreamDetails | undefined;
  onChange: (next: EventStreamDetails) => void;
  /** Compact copy for edit vs create — same fields. */
  idPrefix?: string;
  /** When set, shows Copy Stream Request form link (saved events only). */
  eventId?: string | null;
};

async function copyText(label: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    alert(`${label} is empty`);
    return;
  }
  try {
    await navigator.clipboard.writeText(trimmed);
  } catch {
    alert(`Could not copy ${label}`);
  }
}

const EventStreamDetailsFields: React.FC<Props> = ({
  value,
  onChange,
  idPrefix = 'stream',
  eventId,
}) => {
  const [showKey, setShowKey] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);

  const details: EventStreamDetails = {
    rtmpUrl: value?.rtmpUrl || '',
    streamKey: value?.streamKey || '',
    playbackUrl: value?.playbackUrl || '',
    youtubeChannel: value?.youtubeChannel || '',
    youtubeChannelOther: value?.youtubeChannelOther || '',
    visibility: value?.visibility || '',
    shareWith: value?.shareWith || '',
    requestContactName: value?.requestContactName || '',
    requestContactEmail: value?.requestContactEmail || '',
    requestSubmittedAt: value?.requestSubmittedAt || '',
  };

  const patch = (partial: Partial<EventStreamDetails>) => {
    onChange({ ...details, ...partial });
  };

  const hasRequest = eventHasStreamRequestInfo(details);
  const channelLabel =
    details.youtubeChannel === 'Other' && details.youtubeChannelOther
      ? `Other — ${details.youtubeChannelOther}`
      : details.youtubeChannel || '—';

  const copyRequestLink = async () => {
    if (!eventId) {
      alert('Save the event first, then copy the Stream Request link.');
      return;
    }
    setLinkBusy(true);
    setLinkMessage(null);
    const result = await createStreamRequestLink(eventId);
    setLinkBusy(false);
    if (!result.ok || !result.streamRequestUrl) {
      setLinkMessage(result.error || 'Could not create link');
      return;
    }
    await copyText('Stream Request link', result.streamRequestUrl);
    setLinkMessage(result.reused ? 'Link copied (existing).' : 'Link copied.');
  };

  return (
    <div className="col-span-2 rounded-lg border border-emerald-700/50 bg-emerald-950/20 p-3 space-y-3">
      <div>
        <p className="text-sm font-semibold text-emerald-100">Stream details</p>
        <p className="text-xs text-slate-400 mt-0.5">
          RTMP ingest and stream key for this event. Playback URL is optional. Key is stored with the
          event — treat it as sensitive.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void copyRequestLink()}
          disabled={linkBusy || !eventId}
          className="px-2.5 py-1.5 rounded bg-emerald-700/80 text-emerald-50 text-xs font-medium hover:bg-emerald-600 disabled:opacity-50"
          title={
            eventId
              ? 'Copy public form link to collect YouTube channel, Public/Unlisted, and share-to'
              : 'Save the event first to generate a Stream Request link'
          }
        >
          {linkBusy ? 'Creating link…' : 'Copy Stream Request form link'}
        </button>
        {linkMessage ? <span className="text-[11px] text-slate-400">{linkMessage}</span> : null}
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-rtmp`}
          className="block text-slate-300 text-sm font-medium mb-1"
        >
          RTMP URL
        </label>
        <div className="flex gap-2">
          <input
            id={`${idPrefix}-rtmp`}
            type="text"
            value={details.rtmpUrl}
            onChange={(e) => patch({ rtmpUrl: e.target.value })}
            placeholder="rtmp://… or rtmps://…"
            className="min-w-0 flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm font-mono"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => void copyText('RTMP URL', details.rtmpUrl || '')}
            className="shrink-0 px-2.5 py-2 rounded bg-slate-600 text-slate-100 text-xs hover:bg-slate-500"
          >
            Copy
          </button>
        </div>
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-key`}
          className="block text-slate-300 text-sm font-medium mb-1"
        >
          Stream key
        </label>
        <div className="flex gap-2">
          <input
            id={`${idPrefix}-key`}
            type={showKey ? 'text' : 'password'}
            value={details.streamKey}
            onChange={(e) => patch({ streamKey: e.target.value })}
            placeholder="Stream key"
            className="min-w-0 flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm font-mono"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="shrink-0 px-2.5 py-2 rounded bg-slate-600 text-slate-100 text-xs hover:bg-slate-500"
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            onClick={() => void copyText('Stream key', details.streamKey || '')}
            className="shrink-0 px-2.5 py-2 rounded bg-slate-600 text-slate-100 text-xs hover:bg-slate-500"
          >
            Copy
          </button>
        </div>
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-playback`}
          className="block text-slate-300 text-sm font-medium mb-1"
        >
          Playback / page URL <span className="text-slate-500 font-normal">(optional)</span>
        </label>
        <div className="flex gap-2">
          <input
            id={`${idPrefix}-playback`}
            type="url"
            value={details.playbackUrl}
            onChange={(e) => patch({ playbackUrl: e.target.value })}
            placeholder="https://…"
            className="min-w-0 flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => void copyText('Playback URL', details.playbackUrl || '')}
            className="shrink-0 px-2.5 py-2 rounded bg-slate-600 text-slate-100 text-xs hover:bg-slate-500"
          >
            Copy
          </button>
        </div>
      </div>

      <div className="rounded-md border border-slate-600/80 bg-slate-950/40 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowRequest((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-800/60"
        >
          <span className="text-sm font-medium text-slate-200">
            Stream request info
            {hasRequest ? (
              <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                Received
              </span>
            ) : (
              <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                None yet
              </span>
            )}
          </span>
          <span className="text-slate-400 text-xs">{showRequest ? 'Hide' : 'View more'}</span>
        </button>
        {showRequest ? (
          <div className="px-3 pb-3 pt-1 space-y-2 border-t border-slate-700 text-sm">
            {hasRequest ? (
              <>
                <p className="text-slate-300">
                  <span className="text-slate-500">YouTube channel:</span> {channelLabel}
                </p>
                <p className="text-slate-300">
                  <span className="text-slate-500">Visibility:</span> {details.visibility || '—'}
                </p>
                <p className="text-slate-300 whitespace-pre-wrap">
                  <span className="text-slate-500">Share player link with:</span>{' '}
                  {details.shareWith || '—'}
                </p>
                {(details.requestContactName || details.requestContactEmail) && (
                  <p className="text-slate-300">
                    <span className="text-slate-500">Submitted by:</span>{' '}
                    {[details.requestContactName, details.requestContactEmail]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                {details.requestSubmittedAt ? (
                  <p className="text-xs text-slate-500">
                    Submitted {new Date(details.requestSubmittedAt).toLocaleString()}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-slate-500">
                Copy the Stream Request form link above and send it out. Answers will show here after
                someone submits.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default EventStreamDetailsFields;
