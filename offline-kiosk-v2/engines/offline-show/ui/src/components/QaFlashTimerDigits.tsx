import React from 'react';

type Props = {
  label: string;
  timeBody: string;
  className?: string;
};

/**
 * Flash countdown: readable purple "Q&A" label + mono time (avoids mono-distorted Q).
 */
export function QaFlashTimerDigits({ label, timeBody, className = '' }: Props) {
  const text = String(label || 'Q&A').trim() || 'Q&A';
  const time = String(timeBody || '').trim();
  return (
    <span
      className={`ros-qa-flash-line inline-flex items-baseline justify-center gap-[0.18em] ${className}`}
    >
      <span className="ros-qa-flash-label">{text}</span>
      {time ? <span className="ros-qa-flash-sep" aria-hidden>•</span> : null}
      {time ? <span className="ros-qa-flash-time font-mono tabular-nums">{time}</span> : null}
    </span>
  );
}

export default QaFlashTimerDigits;
