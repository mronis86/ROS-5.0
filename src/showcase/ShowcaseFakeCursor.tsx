import React from 'react';

type Props = {
  x: number;
  y: number;
  visible?: boolean;
  clicking?: boolean;
  moveMs?: number;
};

/** Fake pointer for showcase auto-demos (design-pixel coordinates). */
export const ShowcaseFakeCursor: React.FC<Props> = ({
  x,
  y,
  visible = true,
  clicking = false,
  moveMs = 320,
}) => {
  if (!visible) return null;

  return (
    <div
      className="pointer-events-none absolute z-[200]"
      style={{
        left: x,
        top: y,
        transform: 'translate(-4px, -2px)',
        transition: `left ${moveMs}ms ease-out, top ${moveMs}ms ease-out`,
      }}
      aria-hidden
    >
      {clicking && (
        <div
          className="absolute left-0 top-0 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/30 animate-ping"
          style={{ animationDuration: '450ms' }}
        />
      )}
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        className={`drop-shadow-md ${clicking ? 'scale-90' : 'scale-100'} transition-transform duration-100`}
        style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}
      >
        <path
          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35Z"
          fill="#fff"
          stroke="#111"
          strokeWidth="1.2"
        />
      </svg>
    </div>
  );
};

/**
 * Map element position into root's local design pixels (correct inside scaled showcase viewports).
 */
export function showcaseTargetPoint(
  el: HTMLElement | null,
  root: HTMLElement | null,
  opts?: { offsetX?: number; offsetY?: number; anchor?: 'tap' | 'center' }
): { x: number; y: number } {
  if (!el || !root) return { x: 0, y: 0 };

  const er = el.getBoundingClientRect();
  const rr = root.getBoundingClientRect();
  const layoutW = root.offsetWidth || rr.width || 1;
  const scale = rr.width > 0 ? rr.width / layoutW : 1;

  const w = er.width / scale;
  const h = er.height / scale;
  const baseX = (er.left - rr.left) / scale;
  const baseY = (er.top - rr.top) / scale;

  if (opts?.anchor === 'center') {
    return { x: baseX + w / 2, y: baseY + h / 2 };
  }

  const offsetX = opts?.offsetX ?? 10;
  const offsetY = opts?.offsetY ?? 12;
  return {
    x: baseX + Math.min(offsetX, w * 0.2),
    y: baseY + Math.min(offsetY, h * 0.45),
  };
}

export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Wait for layout after conditional render (modal open, etc.). */
export async function waitForLayout(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** Poll until a ref-mounted element exists (after conditional render). */
export async function waitForElement<T extends HTMLElement>(
  getEl: () => T | null,
  maxMs = 2500
): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const el = getEl();
    if (el) return el;
    await waitMs(40);
    await waitForLayout();
  }
  return getEl();
}
