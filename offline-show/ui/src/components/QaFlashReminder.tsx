import React from 'react';

type Props = {
  label?: string;
  /** Compact badge tucked near the countdown (default). */
  size?: 'lg' | 'sm';
  className?: string;
};

/**
 * Flashing Q&A reminder on Clock / DSM / Full Screen when flash mode is active.
 */
export function QaFlashReminder({ label = 'Q&A', size = 'lg', className = '' }: Props) {
  const text = String(label || 'Q&A').trim() || 'Q&A';
  const sizeClass =
    size === 'sm'
      ? 'px-3 py-1.5 text-lg md:text-xl lg:text-2xl'
      : 'px-5 py-2.5 text-2xl md:text-3xl lg:text-4xl';
  return (
    <div
      className={`pointer-events-none select-none rounded-lg border-2 border-amber-300 bg-amber-500 font-black tracking-wide text-black shadow-lg ros-qa-flash-reminder ${sizeClass} ${className}`}
      role="status"
      aria-live="polite"
    >
      {text}
    </div>
  );
}

export default QaFlashReminder;
