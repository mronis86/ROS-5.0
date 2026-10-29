import React from 'react';

type PptClockFeedControlsProps = {
  canPush: boolean;
  clockFeedActive: boolean;
  autoPush: boolean;
  onAutoPushChange: (on: boolean) => void;
  onPush: () => void;
  onClear: () => void;
};

const PptClockFeedControls: React.FC<PptClockFeedControlsProps> = ({
  canPush,
  clockFeedActive,
  autoPush,
  onAutoPushChange,
  onPush,
  onClear,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label
        className="inline-flex items-center gap-1.5 rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
        title="Saved for this event. Every launcher and stills page follows the same setting, and Clock updates even if someone else checked it."
      >
        <input
          type="checkbox"
          checked={autoPush}
          onChange={(e) => onAutoPushChange(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-slate-500"
        />
        Auto-push PPT cues
      </label>
      <button
        type="button"
        onClick={onPush}
        disabled={!canPush}
        className={`rounded px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
          clockFeedActive
            ? 'border border-emerald-400 bg-emerald-700 text-white hover:bg-emerald-600'
            : 'border border-emerald-600 bg-slate-800 text-emerald-200 hover:bg-slate-700'
        }`}
        title="Show the live PowerPoint preview on Clock / Fullscreen Timer"
      >
        {clockFeedActive ? 'On Clock · Update' : 'Send to Clock'}
      </button>
      {clockFeedActive ? (
        <button
          type="button"
          onClick={onClear}
          className="rounded border border-red-700/70 bg-red-950/50 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-900/50"
          title="Clear PowerPoint from Clock. Auto-push waits until the next PPT cue."
        >
          Clear Clock
        </button>
      ) : null}
    </div>
  );
};

export default PptClockFeedControls;
