import React, { useCallback, useEffect, useState } from 'react';
import { fetchWebQaOverview, type WebQaCueSummary } from '../lib/webQa';

type Kind = 'select' | 'read';

type Props = {
  kind: Kind;
  eventId: string;
  eventName: string;
  qs: string;
  meta?: string;
  onRefresh: () => void;
};

function cueLine(cue: WebQaCueSummary | null, inQa: boolean): { label: string; detail: string } {
  if (!cue) {
    return { label: 'No cue loaded', detail: 'Waiting for ROS' };
  }
  const name = cue.cue || `Item #${cue.id}`;
  const segment = cue.segment_name || '';
  return {
    label: name,
    detail: [segment, inQa || cue.has_qa ? 'Q&A open' : 'Q&A closed']
      .filter(Boolean)
      .join(' · '),
  };
}

export default function QaModToolHeader({
  kind,
  eventId,
  eventName,
  qs,
  meta,
  onRefresh,
}: Props) {
  const [currentCue, setCurrentCue] = useState<WebQaCueSummary | null>(null);
  const [inQaCue, setInQaCue] = useState(false);

  const loadCue = useCallback(async () => {
    if (!eventId) return;
    try {
      const overview = await fetchWebQaOverview(eventId, {
        title: eventName !== 'Event' ? eventName : undefined,
      });
      setCurrentCue(overview.current_cue);
      setInQaCue(overview.in_qa_cue === true);
    } catch {
      // Keep last known cue; page still works without it.
    }
  }, [eventId, eventName]);

  useEffect(() => {
    void loadCue();
    const id = window.setInterval(() => void loadCue(), 4000);
    return () => window.clearInterval(id);
  }, [loadCue]);

  const cue = cueLine(currentCue, inQaCue);
  const isSelect = kind === 'select';

  return (
    <header className="border-b border-slate-800 bg-slate-900/95 sticky top-0 z-20 w-full">
      {/* Main bar: event/cue left, actions right */}
      <div className="w-full px-3 sm:px-4 py-2.5 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-0.5 text-left">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span
              className={`text-[11px] uppercase tracking-wide font-semibold shrink-0 ${
                isSelect ? 'text-fuchsia-300' : 'text-sky-300'
              }`}
            >
              {isSelect ? 'Mod Select' : 'Mod Reader'}
            </span>
            <span className="text-slate-600 hidden sm:inline">·</span>
            <h1 className="text-sm font-semibold text-white truncate">{eventName}</h1>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${
                inQaCue || currentCue?.has_qa
                  ? 'border-emerald-500/50 bg-emerald-950/50 text-emerald-200'
                  : 'border-slate-600 bg-slate-800 text-slate-400'
              }`}
            >
              Cue
            </span>
            <p className="text-xs text-slate-200 truncate">
              <span className="font-semibold text-white">{cue.label}</span>
              {cue.detail ? (
                <span className="text-slate-500">
                  <span className="mx-1.5">·</span>
                  {cue.detail}
                </span>
              ) : null}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {isSelect ? (
            <button
              type="button"
              onClick={() => window.open(`/qa-mod/read?${qs}`, '_blank')}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-md bg-sky-700 hover:bg-sky-600"
            >
              Reader
            </button>
          ) : (
            <button
              type="button"
              onClick={() => window.open(`/qa-mod/select?${qs}`, '_blank')}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-md bg-fuchsia-700 hover:bg-fuchsia-600"
            >
              Select
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onRefresh();
              void loadCue();
            }}
            className="px-2.5 py-1.5 text-xs rounded-md bg-slate-700 hover:bg-slate-600"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Sub bar: queue / approved counts */}
      {meta ? (
        <div className="w-full px-3 sm:px-4 py-2.5 border-t-2 border-slate-600 bg-slate-800 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold tabular-nums tracking-wide text-slate-200">
            {meta}
          </p>
        </div>
      ) : null}
    </header>
  );
}
