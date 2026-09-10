import React, { useState } from 'react';
import type { EventStreamDetails } from '../types/Event';

type Props = {
  value: EventStreamDetails | undefined;
  onChange: (next: EventStreamDetails) => void;
  /** Compact copy for edit vs create — same fields. */
  idPrefix?: string;
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

const EventStreamDetailsFields: React.FC<Props> = ({ value, onChange, idPrefix = 'stream' }) => {
  const [showKey, setShowKey] = useState(false);
  const details: EventStreamDetails = {
    rtmpUrl: value?.rtmpUrl || '',
    streamKey: value?.streamKey || '',
    playbackUrl: value?.playbackUrl || '',
  };

  const patch = (partial: Partial<EventStreamDetails>) => {
    onChange({ ...details, ...partial });
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
    </div>
  );
};

export default EventStreamDetailsFields;
