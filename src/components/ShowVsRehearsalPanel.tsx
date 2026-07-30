import React from 'react';
import type { BaselineDiffRow, RehearsalBaseline } from '../lib/rehearsalBaseline';

interface ShowVsRehearsalPanelProps {
  baseline: RehearsalBaseline | null;
  diffs: BaselineDiffRow[];
  onRecapture?: () => void;
  canRecapture?: boolean;
  recapturing?: boolean;
}

function formatCapturedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const ShowVsRehearsalPanel: React.FC<ShowVsRehearsalPanelProps> = ({
  baseline,
  diffs,
  onRecapture,
  canRecapture,
  recapturing,
}) => {
  if (!baseline) {
    return (
      <div className="text-center py-10 px-4">
        <p className="text-slate-300 mb-2">No rehearsal baseline yet.</p>
        <p className="text-slate-500 text-sm max-w-md mx-auto">
          Switch to <span className="text-green-400 font-medium">In-Show</span> to freeze the current schedule as
          the rehearsal baseline. Edits after that appear here as before → after.
        </p>
      </div>
    );
  }

  const changed = diffs.filter((d) => d.kind === 'changed').length;
  const added = diffs.filter((d) => d.kind === 'added').length;
  const removed = diffs.filter((d) => d.kind === 'removed').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/50 border border-slate-600 rounded-lg px-4 py-3">
        <div className="text-sm text-slate-300">
          <div>
            Baseline captured{' '}
            <span className="text-white font-medium">{formatCapturedAt(baseline.capturedAt)}</span>
          </div>
          <div className="text-slate-500 text-xs mt-0.5">
            {baseline.itemCount} row{baseline.itemCount === 1 ? '' : 's'} frozen · kept if you briefly return to
            Rehearsal
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs px-2 py-1 rounded bg-blue-900/50 text-blue-200">{changed} field change{changed === 1 ? '' : 's'}</span>
          <span className="text-xs px-2 py-1 rounded bg-green-900/50 text-green-200">{added} added</span>
          <span className="text-xs px-2 py-1 rounded bg-red-900/50 text-red-200">{removed} removed</span>
          {canRecapture && onRecapture ? (
            <button
              type="button"
              onClick={onRecapture}
              disabled={recapturing}
              className="px-3 py-1.5 text-xs rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white"
              title="Replace baseline with the current schedule"
            >
              {recapturing ? 'Saving…' : 'Recapture baseline'}
            </button>
          ) : null}
        </div>
      </div>

      {diffs.length === 0 ? (
        <p className="text-slate-400 text-center py-8">
          No differences from rehearsal baseline — schedule matches what was frozen at In-Show.
        </p>
      ) : (
        <div className="space-y-2">
          {diffs.map((d, i) => (
            <div
              key={`${d.kind}-${d.itemId}-${d.field || 'row'}-${i}`}
              className="bg-slate-700 rounded-lg p-3"
            >
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span
                  className={`text-white text-xs px-2 py-0.5 rounded ${
                    d.kind === 'added'
                      ? 'bg-green-600'
                      : d.kind === 'removed'
                        ? 'bg-red-600'
                        : 'bg-blue-600'
                  }`}
                >
                  {d.kind === 'added' ? 'ADDED' : d.kind === 'removed' ? 'REMOVED' : 'CHANGED'}
                </span>
                {d.cue ? (
                  <span className="text-slate-400 text-xs bg-slate-600 px-2 py-0.5 rounded">{d.cue}</span>
                ) : null}
                <span className="text-white text-sm font-medium truncate">{d.segmentName}</span>
                {d.fieldLabel ? (
                  <span className="text-slate-400 text-xs">· {d.fieldLabel}</span>
                ) : null}
              </div>
              {d.kind === 'changed' ? (
                <div className="text-sm text-slate-300 mt-1">
                  <span className="text-red-300 break-words">"{d.before}"</span>
                  <span className="text-slate-500 mx-1.5">→</span>
                  <span className="text-green-300 break-words">"{d.after}"</span>
                </div>
              ) : d.kind === 'added' ? (
                <p className="text-slate-400 text-xs mt-1">Row added after rehearsal baseline was captured.</p>
              ) : (
                <p className="text-slate-400 text-xs mt-1">Row was in rehearsal baseline but is gone now.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ShowVsRehearsalPanel;
