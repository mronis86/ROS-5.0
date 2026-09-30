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
  const available = Math.max(1, Math.floor(opts.availableWidthPx));
  const maxPx = opts.maxPx ?? 72;
  const singleLineFloor = opts.singleLineFloorPx ?? 40;
  const minPx = Math.max(8, opts.minPx ?? 14);
  const weight = String(opts.fontWeight ?? 700);
  const family = opts.fontFamily || 'system-ui, sans-serif';

  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = canvas?.getContext('2d');
  if (!ctx) {
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

  // Prefer 2 lines whenever it yields a noticeably larger (or equal) readable size
  if (bestTwo >= bestOne) {
    return { fontPx: Math.max(minPx, bestTwo), lines: 2 };
  }
  return { fontPx: Math.max(minPx, bestOne), lines: 1 };
}

/** Extra clearance so glyphs stay clear of the timer column. */
const TITLE_TIMER_SAFETY_PX = 8;

/** Width available for the title column beside a flex-shrink / grid timer sibling. */
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
    const rowInner = Math.max(0, row.clientWidth - rowPad);
    const timerW = Math.ceil(timer.getBoundingClientRect().width);
    const fromRow = Math.floor(rowInner - timerW - gap - padX - TITLE_TIMER_SAFETY_PX);
    const fromWrap = Math.floor(wrap.clientWidth - padX - TITLE_TIMER_SAFETY_PX);
    // Use the smaller positive estimate; never invent width the layout does not have.
    const candidates = [fromRow, fromWrap].filter((n) => Number.isFinite(n) && n > 0);
    if (candidates.length) return Math.max(1, Math.min(...candidates));
    return Math.max(1, fromRow);
  }

  return Math.max(1, Math.floor(wrap.clientWidth - padX - TITLE_TIMER_SAFETY_PX));
}

/**
 * Canvas estimate, then DOM verify/shrink so we never need ellipsis.
 * Mutates el styles temporarily for measurement; caller should set final React state.
 */
export function fitEventTitleToElement(opts: {
  el: HTMLElement;
  text: string;
  availableWidthPx: number;
  maxPx?: number;
  minPx?: number;
  singleLineFloorPx?: number;
}): EventTitleFit {
  const el = opts.el;
  const available = Math.max(1, Math.floor(opts.availableWidthPx));
  const maxPx = opts.maxPx ?? 72;
  const minPx = Math.max(8, opts.minPx ?? 12);
  const cs = getComputedStyle(el);

  let next = fitEventTitleSize({
    text: opts.text,
    availableWidthPx: available,
    fontFamily: cs.fontFamily || 'system-ui, sans-serif',
    fontWeight: cs.fontWeight || '700',
    maxPx,
    singleLineFloorPx: opts.singleLineFloorPx ?? 36,
    minPx,
  });

  const applyProbe = (px: number, lines: 1 | 2) => {
    el.style.fontSize = `${px}px`;
    el.style.lineHeight = '1.2';
    el.style.width = `${available}px`;
    el.style.maxWidth = `${available}px`;
    el.style.whiteSpace = lines === 1 ? 'nowrap' : 'normal';
    el.style.overflowWrap = lines === 2 ? 'anywhere' : 'normal';
    el.style.wordBreak = lines === 2 ? 'break-word' : 'normal';
    el.style.overflow = 'visible';
    el.style.textOverflow = 'clip';
  };

  const overflows = (lines: 1 | 2) => {
    if (el.scrollWidth > available + 1) return true;
    if (lines === 2) {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || next.fontPx * 1.2;
      if (el.scrollHeight > lh * 2 + 6) return true;
    }
    return false;
  };

  applyProbe(next.fontPx, next.lines);
  let px = next.fontPx;
  let lines = next.lines;

  while (px > minPx && overflows(lines)) {
    px -= 1;
    applyProbe(px, lines);
  }

  // Still overflowing on one line — switch to two and search largest size that fits
  if (lines === 1 && overflows(1) && String(opts.text || '').trim().includes(' ')) {
    lines = 2;
    let lo = minPx;
    let hi = maxPx;
    let best = minPx;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      applyProbe(mid, 2);
      if (!overflows(2)) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    px = best;
    applyProbe(px, 2);
  }

  // Final shrink pass
  while (px > minPx && overflows(lines)) {
    px -= 1;
    applyProbe(px, lines);
  }

  return { fontPx: px, lines };
}
