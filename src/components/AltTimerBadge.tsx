import React from 'react';
import { getAltTimerParts } from '../lib/altTimerLabel';

type TimerLike = Parameters<typeof getAltTimerParts>[0];

type AltTimerBadgeProps = {
  timer: TimerLike;
  scheduleItems?: any[] | null;
  /** e.g. "RUNNING · RESOLUME - " */
  statusPrefix?: string;
  /** e.g. " · RESOLUME" */
  resolumeSuffix?: string;
  /** Small display: ALT badge + cue only (no segment name) */
  cueOnly?: boolean;
};

/**
 * Compact orange ALT pill + "CUE # - Segment Name" for Clock & Fullscreen secondary timers.
 */
export function AltTimerBadge({
  timer,
  scheduleItems,
  statusPrefix = '',
  resolumeSuffix = '',
  cueOnly = false,
}: AltTimerBadgeProps) {
  if (!timer) return null;

  const { cueLabel, segment } = getAltTimerParts(timer, scheduleItems);
  const line = cueOnly ? cueLabel : segment ? `${cueLabel} - ${segment}` : cueLabel;
  const status = cueOnly ? '' : String(statusPrefix || '').replace(/\s*-\s*$/, '').trim();

  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
      <span className="rounded bg-orange-500 px-2 py-0.5 text-xs font-black leading-none tracking-widest text-black translate-y-px">
        ALT
      </span>
      {status ? (
        <span className="text-sm font-semibold leading-none text-yellow-200">{status}</span>
      ) : null}
      <span className="leading-none">
        {line}
        {!cueOnly && resolumeSuffix && !statusPrefix ? resolumeSuffix : ''}
      </span>
    </span>
  );
}
