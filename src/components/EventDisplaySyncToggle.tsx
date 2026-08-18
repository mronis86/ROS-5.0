import React from 'react';
import { DISPLAY_SYNC_COLUMN_LABEL } from '../lib/displaySync';

type EventDisplaySyncToggleProps = {
  enabled: boolean;
  disabled?: boolean;
  saving?: boolean;
  onToggle: () => void;
  /** table = event list column; inline = mobile card row */
  variant?: 'table' | 'inline';
};

const EventDisplaySyncToggle: React.FC<EventDisplaySyncToggleProps> = ({
  enabled,
  disabled = false,
  saving = false,
  onToggle,
  variant = 'table',
}) => {
  const label = enabled ? 'On' : 'Off';
  const title = enabled
    ? 'Display sync enabled — Green Room, Photo View, and other followers may poll this event'
    : 'Display sync paused — follower displays will stop syncing until turned back on';

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled || saving}
        title={title}
        aria-pressed={enabled}
        className={`inline-flex min-h-[36px] w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${
          enabled
            ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/40'
            : 'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
        } disabled:opacity-50`}
      >
        <span>{DISPLAY_SYNC_COLUMN_LABEL}</span>
        <span>{saving ? '…' : label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled || saving}
      title={title}
      aria-pressed={enabled}
      className={`inline-flex min-w-[4.5rem] items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold transition-colors ${
        enabled
          ? 'border-emerald-700/60 bg-emerald-950/50 text-emerald-200 hover:bg-emerald-900/50'
          : 'border-slate-600 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
      } disabled:opacity-50`}
    >
      <span
        className={`h-2 w-2 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-slate-500'}`}
        aria-hidden
      />
      {saving ? '…' : label}
    </button>
  );
};

export default EventDisplaySyncToggle;
