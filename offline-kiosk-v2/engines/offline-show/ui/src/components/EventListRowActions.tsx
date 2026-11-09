import React from 'react';

type EventListRowActionsProps = {
  layout: 'table' | 'mobile';
  mode: 'standard' | 'quickMode';
  onLaunch?: () => void;
  onEdit?: () => void;
  onDelete: () => void;
  onOpenQuickMode?: () => void;
};

const PlayIcon = () => (
  <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
    <path d="M6.3 4.842A1.5 1.5 0 004 6.11v7.78a1.5 1.5 0 002.3 1.269l6.504-3.89a1.5 1.5 0 000-2.538L6.3 4.842z" />
  </svg>
);

const PencilIcon = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
  </svg>
);

const TrashIcon = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
    <path
      fillRule="evenodd"
      d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.484 0 .896.046 1.25.125V3.75a1.25 1.25 0 00-2.5 0v.375c.354-.08.766-.125 1.25-.125z"
      clipRule="evenodd"
    />
  </svg>
);

const iconButtonClass =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70';

const EventListRowActions: React.FC<EventListRowActionsProps> = ({
  layout,
  mode,
  onLaunch,
  onEdit,
  onDelete,
  onOpenQuickMode,
}) => {
  if (mode === 'quickMode') {
    if (layout === 'mobile') {
      return (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={onOpenQuickMode}
            className="min-h-[38px] rounded-md bg-yellow-600 px-3 py-2 text-xs font-bold text-slate-900 hover:bg-yellow-500"
          >
            Open
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="min-h-[38px] rounded-md border border-red-700/60 bg-red-950/30 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-900/40"
          >
            Delete
          </button>
        </div>
      );
    }

    return (
      <div className="inline-flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={onOpenQuickMode}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-yellow-600 px-3 text-xs font-semibold text-slate-900 hover:bg-yellow-500"
        >
          Open
        </button>
        <button
          type="button"
          onClick={onDelete}
          className={`${iconButtonClass} text-slate-400 hover:bg-red-950/50 hover:text-red-300`}
          title="Delete session"
          aria-label="Delete session"
        >
          <TrashIcon />
        </button>
      </div>
    );
  }

  if (layout === 'mobile') {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={onLaunch}
          className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-500"
        >
          <PlayIcon />
          Launch Run of Show
        </button>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="min-h-[36px] rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="min-h-[36px] rounded-md border border-red-800/50 bg-red-950/20 px-2 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-900/30"
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center justify-center gap-1">
      <button
        type="button"
        onClick={onLaunch}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white hover:bg-blue-500"
        title="Launch Run of Show"
      >
        <PlayIcon />
        Launch
      </button>
      <div className="ml-0.5 inline-flex items-center gap-0.5 rounded-md border border-slate-600/80 bg-slate-900/50 p-0.5">
        <button
          type="button"
          onClick={onEdit}
          className={`${iconButtonClass} text-slate-300 hover:bg-slate-700 hover:text-white`}
          title="Edit event"
          aria-label="Edit event"
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className={`${iconButtonClass} text-slate-400 hover:bg-red-950/60 hover:text-red-300`}
          title="Delete event"
          aria-label="Delete event"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
};

export default EventListRowActions;
