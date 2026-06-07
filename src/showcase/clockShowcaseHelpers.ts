/** Clock page helpers — mirrors production Clock.tsx color/time logic. */

export function formatClockTime(seconds: number): string {
  const isNegative = seconds < 0;
  const absSeconds = Math.abs(seconds);
  const hours = Math.floor(absSeconds / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  const secs = Math.floor(absSeconds % 60);
  const sign = isNegative ? '-' : '';
  if (hours === 0) {
    return `${sign}${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatClockTimeOfDay(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Same thresholds as Clock.getProgressBarColor */
export function clockProgressColor(remainingSeconds: number, isRunning = true): string {
  if (!isRunning) return '#6b7280';
  if (remainingSeconds > 120) return '#10b981';
  if (remainingSeconds > 30) return '#f59e0b';
  return '#ef4444';
}

export function clockRemainingPercent(remainingSeconds: number, totalSeconds: number, isRunning = true): number {
  if (!isRunning || totalSeconds <= 0) return 100;
  return Math.min(100, Math.max(0, (remainingSeconds / totalSeconds) * 100));
}

/** Message box font size — mirrors Clock.tsx thresholds. */
export function clockMessageFontSize(message: string): string {
  const words = message.split(/\s+/).filter(Boolean).length;
  const hasDescenders = /[gjpqy]/i.test(message);
  if (words <= 3) return hasDescenders ? 'clamp(3rem, 12vw, 16rem)' : 'clamp(3.5rem, 13.5vw, 18rem)';
  if (words <= 6) return hasDescenders ? 'clamp(1.9rem, 8vw, 12rem)' : 'clamp(2.25rem, 9vw, 13.5rem)';
  if (words <= 10) return hasDescenders ? 'clamp(1.4rem, 6vw, 9rem)' : 'clamp(1.6rem, 7vw, 10.5rem)';
  return hasDescenders ? 'clamp(0.9rem, 4vw, 6rem)' : 'clamp(1.1rem, 5vw, 7rem)';
}

export function formatClockMessage(message: string): string {
  const words = message.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return message;
  if (words.length <= 6) {
    const mid = Math.ceil(words.length / 2);
    return `${words.slice(0, mid).join(' ')}\n${words.slice(mid).join(' ')}`;
  }
  const third = Math.ceil(words.length / 3);
  return `${words.slice(0, third).join(' ')}\n${words.slice(third, third * 2).join(' ')}\n${words.slice(third * 2).join(' ')}`;
}

export const CLOCK_SHOWCASE_STYLES = `
  @keyframes clockShowcaseZoomIn {
    from { transform: scale(0.88); }
    to { transform: scale(1); }
  }
  @keyframes clockShowcaseSlideFromTop {
    from { opacity: 0; transform: translate(-50%, -12px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
  @keyframes clockShowcaseMessageIn {
    from { transform: scale(0.92); }
    to { transform: scale(1); }
  }
  .clock-showcase-zoom-in {
    animation: clockShowcaseZoomIn 500ms cubic-bezier(0.16, 1, 0.3, 1) both;
    transform-origin: center center;
  }
  .clock-showcase-slide-top {
    animation: clockShowcaseSlideFromTop 450ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .clock-showcase-message-in {
    animation: clockShowcaseMessageIn 500ms cubic-bezier(0.16, 1, 0.3, 1) both;
    transform-origin: center center;
  }
`;
