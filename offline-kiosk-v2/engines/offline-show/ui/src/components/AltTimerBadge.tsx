import React from 'react';
import { getAltTimerParts, getSecondaryTimerBadgeText } from '../lib/altTimerLabel';

type TimerLike = Parameters<typeof getAltTimerParts>[0];

type AltTimerBadgeProps = {
  timer: TimerLike;
  scheduleItems?: any[] | null;
  /** e.g. "RUNNING · RESOLUME - " */
  statusPrefix?: string;
  /** e.g. " · RESOLUME" */
  resolumeSuffix?: string;
  /** Small display: badge + cue only (no segment name) */
  cueOnly?: boolean;
};

/**
 * Compact secondary-timer pill + cue/label for Clock & Fullscreen.
 * Operator countdowns use a purple ALT pill; Q&A uses "Q&A Timer"; sub-cues stay orange ALT.
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
  const isOperator =
    (timer as any)?.source === 'operator' || (timer as any)?.timer_id === 'OPERATOR';
  const badgeText = getSecondaryTimerBadgeText(timer, scheduleItems);
  const isQa = badgeText === 'Q&A Timer';
  const badgeClass = isOperator
    ? 'rounded bg-violet-500 px-2 py-0.5 text-xs font-black leading-none tracking-widest text-white translate-y-px'
    : isQa
      ? 'rounded bg-amber-500 px-2 py-0.5 text-xs font-black leading-none tracking-wide text-black translate-y-px'
      : 'rounded bg-orange-500 px-2 py-0.5 text-xs font-black leading-none tracking-widest text-black translate-y-px';

  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
      <span className={badgeClass}>{badgeText}</span>
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
