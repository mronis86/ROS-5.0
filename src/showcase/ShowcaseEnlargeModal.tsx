import React, { useEffect, useRef, useState } from 'react';
import ShowcaseScaledViewport from './ShowcaseScaledViewport';
import type { ShowcaseScreenMeta } from './showcaseTypes';

type Props = {
  screen: ShowcaseScreenMeta | null;
  onClose: () => void;
};

/** Modal width cap — scales mock to ~1:1 at enlarge (portrait mocks stay narrow). */
function getEnlargeModalMaxWidthClass(screen: ShowcaseScreenMeta): string {
  if (screen.enlargeMaxWidth === '7xl') return 'max-w-7xl';
  if (screen.enlargeMaxWidth === '6xl') return 'max-w-6xl';
  if (screen.designWidth <= 500) return 'max-w-md';
  if (screen.designWidth > 1320) return 'max-w-[1400px]';
  return 'max-w-7xl';
}

const ShowcaseEnlargeModal: React.FC<Props> = ({ screen, onClose }) => {
  const viewportHostRef = useRef<HTMLDivElement>(null);
  const [fitHeight, setFitHeight] = useState<number | undefined>();

  useEffect(() => {
    if (!screen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [screen, onClose]);

  useEffect(() => {
    if (!screen || (screen.enlargeFit ?? 'width') !== 'contain') return;
    const host = viewportHostRef.current;
    if (!host) return;
    const update = () => {
      const h = host.clientHeight;
      if (h > 0) setFitHeight(h);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, [screen]);

  if (!screen) return null;

  const enlargeFit = screen.enlargeFit ?? 'width';
  const modalMaxWidth = getEnlargeModalMaxWidthClass(screen);
  const widthFit = enlargeFit === 'width';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="showcase-enlarge-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/85 backdrop-blur-sm"
        aria-label="Close enlarged preview"
        onClick={onClose}
      />
      <div
        className={`relative z-10 flex w-full ${modalMaxWidth} max-h-[92vh] flex-col overflow-hidden rounded-2xl border border-slate-600 bg-slate-900 shadow-2xl`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-700 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id="showcase-enlarge-title" className="text-lg font-semibold text-white">
              {screen.title}
            </h2>
            <p className="mt-0.5 text-sm text-slate-400">{screen.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700"
          >
            Close
          </button>
        </div>
        <div
          ref={viewportHostRef}
          className={`flex min-h-0 flex-1 bg-slate-950 ${
            widthFit ? 'overflow-auto' : 'items-center justify-center overflow-hidden'
          }`}
        >
          <ShowcaseScaledViewport
            designWidth={screen.designWidth}
            designHeight={screen.designHeight}
            maxDisplayHeight={widthFit ? undefined : fitHeight}
            fitMode={enlargeFit}
            viewportMode="enlarge"
            className="w-full min-h-[200px] shrink-0"
          >
            {screen.render()}
          </ShowcaseScaledViewport>
        </div>
      </div>
    </div>
  );
};

export default ShowcaseEnlargeModal;
