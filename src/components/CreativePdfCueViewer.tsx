import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Expand,
} from 'lucide-react';
import { loadPdfJs } from '../lib/pdfJsLoader';

type FitMode = 'width' | 'page';

type Props = {
  url: string;
  /** 1-based page to show */
  page: number;
  className?: string;
  onNumPages?: (n: number) => void;
  onPageChange?: (page: number) => void;
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;

/**
 * PDF.js canvas viewer with fit/zoom and fullscreen popout for Content Review.
 */
const CreativePdfCueViewer: React.FC<Props> = ({
  url,
  page,
  className = '',
  onNumPages,
  onPageChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<any>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [fitMode, setFitMode] = useState<FitMode>('page');
  const [zoom, setZoom] = useState(1);
  const [popout, setPopout] = useState(false);
  const [layoutTick, setLayoutTick] = useState(0);
  const [displayZoomPct, setDisplayZoomPct] = useState(100);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    pdfRef.current = null;

    void (async () => {
      try {
        const pdfjsLib = await loadPdfJs();
        const pdf = await pdfjsLib.getDocument({ url }).promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        onNumPages?.(pdf.numPages);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load PDF');
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      pdfRef.current = null;
    };
  }, [url, onNumPages]);

  useEffect(() => {
    if (!numPages) return;
    const next = Math.min(Math.max(1, page || 1), numPages);
    setCurrentPage(next);
  }, [page, numPages]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setLayoutTick((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [popout]);

  useEffect(() => {
    if (!popout) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopout(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [popout]);

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!pdf || !canvas || !container || loading) return;

    let cancelled = false;
    void (async () => {
      try {
        renderTaskRef.current?.cancel();
        const pdfPage = await pdf.getPage(currentPage);
        if (cancelled) return;

        const base = pdfPage.getViewport({ scale: 1 });
        const pad = 16;
        const availW = Math.max(160, container.clientWidth - pad);
        const availH = Math.max(160, container.clientHeight - pad);
        const fitScale =
          fitMode === 'width'
            ? availW / base.width
            : Math.min(availW / base.width, availH / base.height);
        const scale = Math.max(0.1, fitScale * zoom);
        setDisplayZoomPct(Math.round(scale * 100));

        const viewport = pdfPage.getViewport({ scale });
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
        const task = pdfPage.render({ canvasContext: ctx, viewport, transform });
        renderTaskRef.current = task;
        await task.promise;
      } catch (e) {
        if (cancelled) return;
        if ((e as { name?: string })?.name === 'RenderingCancelledException') return;
        setError(e instanceof Error ? e.message : 'Failed to render page');
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [currentPage, loading, url, numPages, fitMode, zoom, layoutTick, popout]);

  const go = useCallback(
    (next: number) => {
      if (!numPages) return;
      const p = Math.min(Math.max(1, next), numPages);
      setCurrentPage(p);
      onPageChange?.(p);
    },
    [numPages, onPageChange]
  );

  const adjustZoom = useCallback((delta: number) => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)));
  }, []);

  const setFit = useCallback((mode: FitMode) => {
    setFitMode(mode);
    setZoom(1);
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      adjustZoom(e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
    },
    [adjustZoom]
  );

  const toolbarBtn =
    'inline-flex items-center justify-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-transparent';
  const toolbarBtnActive = 'bg-violet-700/80 text-white hover:bg-violet-600';

  const toolbar = (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-slate-900/95 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          disabled={currentPage <= 1 || loading}
          onClick={() => go(currentPage - 1)}
          className={toolbarBtn}
          title="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Prev
        </button>
        <button
          type="button"
          disabled={currentPage >= numPages || loading}
          onClick={() => go(currentPage + 1)}
          className={toolbarBtn}
          title="Next page"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <span className="mx-1 text-[11px] tabular-nums text-slate-400">
          {loading ? 'Loading…' : `Page ${currentPage}${numPages ? ` / ${numPages}` : ''}`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => setFit('page')}
          className={`${toolbarBtn} ${fitMode === 'page' && zoom === 1 ? toolbarBtnActive : ''}`}
          title="Fit entire page in view"
        >
          Fit page
        </button>
        <button
          type="button"
          onClick={() => setFit('width')}
          className={`${toolbarBtn} ${fitMode === 'width' && zoom === 1 ? toolbarBtnActive : ''}`}
          title="Fit page width"
        >
          Fit width
        </button>
        <button
          type="button"
          disabled={zoom <= ZOOM_MIN || loading}
          onClick={() => adjustZoom(-ZOOM_STEP)}
          className={toolbarBtn}
          title="Zoom out (Ctrl+scroll)"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-[2.75rem] text-center text-[11px] tabular-nums text-slate-300">
          {displayZoomPct}%
        </span>
        <button
          type="button"
          disabled={zoom >= ZOOM_MAX || loading}
          onClick={() => adjustZoom(ZOOM_STEP)}
          className={toolbarBtn}
          title="Zoom in (Ctrl+scroll)"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(1);
          }}
          className={toolbarBtn}
          title="Reset zoom to current fit"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => setPopout((v) => !v)}
          className={`${toolbarBtn} ${popout ? toolbarBtnActive : ''}`}
          title={popout ? 'Exit fullscreen' : 'Open fullscreen popout'}
        >
          {popout ? (
            <>
              <Minimize2 className="h-3.5 w-3.5" />
              Exit
            </>
          ) : (
            <>
              <Maximize2 className="h-3.5 w-3.5" />
              Fullscreen
            </>
          )}
        </button>
      </div>
    </div>
  );

  const body = (
    <>
      {toolbar}
      <div
        ref={containerRef}
        onWheel={onWheel}
        className="min-h-0 flex-1 overflow-auto bg-slate-950 p-2"
      >
        {error ? (
          <p className="p-4 text-center text-sm text-rose-300">{error}</p>
        ) : (
          <canvas ref={canvasRef} className="mx-auto block bg-white shadow-lg" />
        )}
      </div>
      {!popout ? (
        <p className="shrink-0 border-t border-slate-800 px-2 py-1 text-[10px] text-slate-500">
          Fit page / Fit width · zoom · Ctrl+scroll · Fullscreen for a larger review view
        </p>
      ) : null}
    </>
  );

  if (popout) {
    return (
      <>
        <div
          className={`flex h-full min-h-0 flex-col items-center justify-center gap-2 bg-slate-950/80 ${className}`}
        >
          <Expand className="h-6 w-6 text-slate-500" />
          <p className="text-xs text-slate-400">PDF open in fullscreen</p>
          <button
            type="button"
            onClick={() => setPopout(false)}
            className="rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600"
          >
            Return here
          </button>
        </div>
        {createPortal(
          <div className="fixed inset-0 z-[220] flex flex-col bg-black/80 p-2 sm:p-4">
            <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col overflow-hidden rounded-xl border border-slate-600 bg-slate-950 shadow-2xl">
              {body}
            </div>
          </div>,
          document.body
        )}
      </>
    );
  }

  return <div className={`flex h-full min-h-0 flex-col bg-slate-950 ${className}`}>{body}</div>;
};

export default CreativePdfCueViewer;
