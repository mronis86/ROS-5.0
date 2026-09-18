export type EventTitleFit = { fontPx: number; lines: 1 | 2 };

/**
 * Fit an event title into a fixed width: prefer one line (shrink), then two lines
 * for very long multi-word names. Uses canvas measureText + word-split counting.
 */
export function fitEventTitleSize(opts: {
  text: string;
  availableWidthPx: number;
  fontFamily: string;
  fontWeight?: string | number;
  maxPx?: number;
  /** Prefer wrapping only below this 1-line size */
  singleLineFloorPx?: number;
  minPx?: number;
}): EventTitleFit {
  const text = String(opts.text || '').trim() || 'Event';
  const available = Math.max(40, Math.floor(opts.availableWidthPx));
  const maxPx = opts.maxPx ?? 72;
  const singleLineFloor = opts.singleLineFloorPx ?? 40;
  const minPx = opts.minPx ?? 20;
  const weight = String(opts.fontWeight ?? 700);
  const family = opts.fontFamily || 'system-ui, sans-serif';

  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext('2d');
  if (!ctx) {
    // Fallback: rough char-count estimate
    const chars = text.length || 1;
    const est = Math.min(maxPx, Math.max(minPx, Math.floor((available / chars) * 1.6)));
    return { fontPx: est, lines: chars > 28 ? 2 : 1 };
  }

  const measure = (str: string, px: number) => {
    ctx.font = `${weight} ${px}px ${family}`;
    return ctx.measureText(str).width;
  };

  const fitsOneLine = (px: number) => measure(text, px) <= available - 1;

  let lo = minPx;
  let hi = maxPx;
  let bestOne = minPx;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fitsOneLine(mid)) {
      bestOne = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const words = text.split(/\s+/).filter(Boolean);

  // Comfortable on one line, or single word (can't wrap cleanly)
  if (bestOne >= singleLineFloor || words.length < 2) {
    return { fontPx: Math.max(minPx, bestOne), lines: 1 };
  }

  // Word-count aware 2-line split: try every break, pick the tightest max-line width
  const maxLineWidthAt = (px: number) => {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 1; i < words.length; i++) {
      const left = words.slice(0, i).join(' ');
      const right = words.slice(i).join(' ');
      // Prefer splits that don't leave a lone short word on line 2 when possible
      const orphanPenalty =
        right.split(/\s+/).length === 1 && right.length <= 4 && words.length > 3 ? px * 0.35 : 0;
      const w = Math.max(measure(left, px), measure(right, px)) + orphanPenalty;
      if (w < best) best = w;
    }
    return best;
  };

  const fitsTwoLines = (px: number) => maxLineWidthAt(px) <= available - 1;

  lo = minPx;
  hi = maxPx;
  let bestTwo = minPx;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fitsTwoLines(mid)) {
      bestTwo = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (bestTwo >= bestOne + 2) {
    return { fontPx: bestTwo, lines: 2 };
  }
  return { fontPx: Math.max(minPx, bestOne), lines: 1 };
}

/** Width available for the title column beside a flex-shrink timer sibling. */
export function measureTitleSlotWidth(wrap: HTMLElement): number {
  const row = wrap.parentElement;
  const timer = wrap.nextElementSibling as HTMLElement | null;
  const wrapStyle = getComputedStyle(wrap);
  const padX =
    (parseFloat(wrapStyle.paddingLeft) || 0) + (parseFloat(wrapStyle.paddingRight) || 0);

  if (row && timer) {
    const rowStyle = getComputedStyle(row);
    const gap = parseFloat(rowStyle.columnGap || rowStyle.gap || '0') || 0;
    const rowPad =
      (parseFloat(rowStyle.paddingLeft) || 0) + (parseFloat(rowStyle.paddingRight) || 0);
    const rowInner = row.clientWidth - rowPad;
    const timerW = Math.ceil(timer.getBoundingClientRect().width);
    return Math.max(40, Math.floor(rowInner - timerW - gap - padX));
  }

  return Math.max(40, Math.floor(wrap.clientWidth - padX));
}
