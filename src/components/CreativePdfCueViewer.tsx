import React, { useEffect, useRef, useState } from 'react';
import { loadPdfJs } from '../lib/pdfJsLoader';

type Props = {
  url: string;
  /** 1-based page to show */
  page: number;
  className?: string;
  onNumPages?: (n: number) => void;
  onPageChange?: (page: number) => void;
};

/**
 * Lightweight PDF.js canvas viewer — jumps to `page` when cue selection changes.
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
        const availW = Math.max(200, container.clientWidth - 16);
        const scale = availW / base.width;
        const viewport = pdfPage.getViewport({ scale });

        const outputScale = window.devicePixelRatio || 1;
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
  }, [currentPage, loading, url, numPages]);

  const go = (next: number) => {
    if (!numPages) return;
    const p = Math.min(Math.max(1, next), numPages);
    setCurrentPage(p);
    onPageChange?.(p);
  };

  return (
    <div className={`flex h-full min-h-0 flex-col bg-slate-950 ${className}`}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-700 bg-slate-900/90 px-2 py-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={currentPage <= 1 || loading}
            onClick={() => go(currentPage - 1)}
            className="rounded px-2 py-0.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={currentPage >= numPages || loading}
            onClick={() => go(currentPage + 1)}
            className="rounded px-2 py-0.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
          >
            Next
          </button>
        </div>
        <span className="text-[11px] tabular-nums text-slate-400">
          {loading ? 'Loading…' : `Page ${currentPage}${numPages ? ` of ${numPages}` : ''}`}
        </span>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto p-2">
        {error ? (
          <p className="p-4 text-center text-sm text-rose-300">{error}</p>
        ) : (
          <canvas ref={canvasRef} className="mx-auto block bg-white shadow-lg" />
        )}
      </div>
    </div>
  );
};

export default CreativePdfCueViewer;
