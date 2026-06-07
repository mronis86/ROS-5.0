import React, { useEffect, useRef, useState } from 'react';
import { ShowcaseViewportProvider, type ShowcaseViewportMode } from './ShowcaseViewportContext';
import type { ShowcaseEnlargeFit } from './showcaseTypes';

type Props = {
  designWidth: number;
  designHeight: number;
  children: React.ReactNode;
  className?: string;
  /** Cap visible height (grid thumbnails). Scales to fit so the full design is visible. */
  maxDisplayHeight?: number;
  /** contain = fit width + height; width = scale by width only (taller content scrolls in parent). */
  fitMode?: ShowcaseEnlargeFit;
  viewportMode?: ShowcaseViewportMode;
};

type Layout = {
  scale: number;
  offsetX: number;
  displayHeight: number;
  widthClipped: boolean;
};

/** Renders UI at production width, scaled down to fit the card — keeps real Tailwind sizes. */
const ShowcaseScaledViewport: React.FC<Props> = ({
  designWidth,
  designHeight,
  children,
  className = '',
  maxDisplayHeight,
  fitMode = 'contain',
  viewportMode = 'compact',
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>({
    scale: 0.5,
    offsetX: 0,
    displayHeight: 360,
    widthClipped: false,
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const w = host.clientWidth;
      if (w <= 0) return;

      const scaleW = w / designWidth;
      const scale =
        fitMode === 'width'
          ? scaleW
          : maxDisplayHeight != null
            ? Math.min(scaleW, maxDisplayHeight / designHeight)
            : scaleW;

      const contentWidth = designWidth * scale;
      const heightLimited = fitMode === 'contain' && maxDisplayHeight != null && scale < scaleW - 0.001;
      const offsetX = heightLimited ? Math.max(0, (w - contentWidth) / 2) : 0;
      const displayHeight = designHeight * scale;

      setLayout({
        scale,
        offsetX,
        displayHeight,
        widthClipped: heightLimited,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, [designWidth, designHeight, maxDisplayHeight, fitMode]);

  const { scale, offsetX, displayHeight, widthClipped } = layout;

  return (
    <div
      ref={hostRef}
      className={`relative w-full overflow-hidden bg-slate-950 ${className}`}
      style={{ height: displayHeight }}
    >
      {widthClipped && (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-slate-950 to-transparent"
          aria-hidden
        />
      )}
      <div
        style={{
          position: 'absolute',
          left: offsetX,
          top: 0,
          width: designWidth,
          height: designHeight,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <ShowcaseViewportProvider mode={viewportMode}>{children}</ShowcaseViewportProvider>
      </div>
    </div>
  );
};

export default ShowcaseScaledViewport;
