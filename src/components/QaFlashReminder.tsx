import React from 'react';

type Props = {
  label?: string;
  /** Compact badge tucked near the countdown (default). */
  size?: 'lg' | 'sm';
  className?: string;
};

/**
 * Legacy badge (stage clocks now use QaFlashTimerDigits in the countdown).
 * Kept for any remaining callers / offline stubs — purple to match Q&A stage color.
 */
export function QaFlashReminder({ label = 'Q&A', size = 'lg', className = '' }: Props) {
  const text = String(label || 'Q&A').trim() || 'Q&A';
  const sizeClass =
    size === 'sm'
      ? 'px-3 py-1.5 text-lg md:text-xl lg:text-2xl'
      : 'px-5 py-2.5 text-2xl md:text-3xl lg:text-4xl';
  return (
    <div
      className={`pointer-events-none select-none rounded-lg border-2 border-fuchsia-300 bg-fuchsia-600 font-black tracking-wide text-white shadow-lg shadow-fuchsia-500/40 ros-qa-flash-reminder ${sizeClass} ${className}`}
      role="status"
      aria-live="polite"
    >
      {text}
    </div>
  );
}

export default QaFlashReminder;
