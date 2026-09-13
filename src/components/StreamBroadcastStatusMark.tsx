import React from 'react';
import {
  streamBroadcastBadgeState,
  type EventStreamDetails,
} from '../types/Event';

type Props = {
  details?: EventStreamDetails | null;
  className?: string;
};

/**
 * Broadcast status marks — high-contrast so they read on green/violet pills.
 * ! = needs setup, ◇ = form submitted, ✓ = RTMP+key ready.
 */
const StreamBroadcastStatusMark: React.FC<Props> = ({ details, className = '' }) => {
  const state = streamBroadcastBadgeState(details);
  const base = 'rounded px-1 text-[10px] font-black leading-none tracking-wide';

  if (state === 'ready') {
    return (
      <span
        className={`inline-flex items-center justify-center rounded px-[3px] py-px text-[11px] font-black leading-none bg-emerald-400 text-emerald-950 ${className}`}
        title="RTMP URL and stream key saved"
        aria-label="Stream details ready"
      >
        ✓
      </span>
    );
  }

  if (state === 'request') {
    return (
      <span
        className={`${base} bg-sky-950/55 text-sky-100 ${className}`}
        title="Stream request form submitted — add RTMP + stream key in Edit"
        aria-label="Stream request received"
      >
        ◇
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded px-[3px] py-px text-[11px] font-black leading-none bg-amber-400 text-amber-950 ${className}`}
      title="Add RTMP + stream key in Edit (or send Stream Request form)"
      aria-label="Stream details needed"
    >
      !
    </span>
  );
};

export default StreamBroadcastStatusMark;
