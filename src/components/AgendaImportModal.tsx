import React, { useState, useRef, useCallback, useEffect } from 'react';
import { getApiBaseUrl } from '../services/api-client';
import { authHeaders } from '../lib/sessionAuth';
import {
  parseAgenda,
  parseTimeToMinutes,
  minutesToHHMMSS,
  getLinesWithTimeIndices,
  type AgendaParsedItem,
  type ParseHints,
} from '../lib/agenda-parser';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

// Use the parser's canonical type — keeps fields in sync automatically.
export type AgendaParsedRow = AgendaParsedItem;

interface AgendaImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (data: AgendaParsedRow[]) => void;
  onDeleteAll: () => void;
}

type Step = 'select' | 'preview' | 'lines' | 'parse';
type FieldLabel = 'time' | 'segment' | 'person';
type SpeakerLocation = 'Podium' | 'Seat' | 'Virtual' | 'Moderator';

interface FieldSample { id: string; text: string; label: FieldLabel; }
interface SpeakerEdit {
  id: string; slot: number; location: SpeakerLocation;
  fullName: string; title: string; org: string; photoLink: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const LABEL_META: Record<FieldLabel, {
  emoji: string; label: string; desc: string;
  bg: string; activeBg: string; border: string; text: string; dot: string; mark: string;
}> = {
  time:    { emoji: '⏱', label: 'Time',         desc: 'Start time or time range',
             bg: 'bg-amber-500/15', activeBg: 'bg-amber-500', border: 'border-amber-500',
             text: 'text-amber-200', dot: 'bg-amber-400', mark: 'rgba(251,191,36,0.38)' },
  segment: { emoji: '📌', label: 'Segment Name', desc: 'Session title or agenda item',
             bg: 'bg-blue-500/15',  activeBg: 'bg-blue-600',  border: 'border-blue-500',
             text: 'text-blue-200',  dot: 'bg-blue-400',  mark: 'rgba(96,165,250,0.38)'  },
  person:  { emoji: '🎤', label: 'Person',       desc: 'Speaker or presenter name',
             bg: 'bg-green-500/15', activeBg: 'bg-green-600', border: 'border-green-500',
             text: 'text-green-200', dot: 'bg-green-400', mark: 'rgba(74,222,128,0.38)'  },
};
const LABEL_KEYS: FieldLabel[] = ['time', 'segment', 'person'];

const PROGRAM_TYPES = [
  'PreShow/End','Podium Transition','Panel Transition','Full-Stage/Ted-Talk','Sub Cue',
  'No Transition','Video','Panel+Remote','Remote Only','Break F&B/B2B','Breakout Session','TBD','KILLED',
];
const PROGRAM_TYPE_COLORS: Record<string, string> = {
  'PreShow/End':'#8B5CF6','Podium Transition':'#8B4513','Panel Transition':'#404040',
  'Sub Cue':'#F3F4F6','No Transition':'#059669','Video':'#F59E0B','Panel+Remote':'#1E40AF',
  'Remote Only':'#60A5FA','Break F&B/B2B':'#EC4899','Breakout Session':'#20B2AA',
  'TBD':'#6B7280','KILLED':'#DC2626','Full-Stage/Ted-Talk':'#EA580C',
};

// ─────────────────────────────────────────────────────────────────────────────
// DocViewer component
// ─────────────────────────────────────────────────────────────────────────────

interface DocViewerProps {
  file: File;
  samples: FieldSample[];
  onAddSample: (text: string, label: FieldLabel) => void;
}

// CSS injected into the Word doc iframe so tables look real
const DOCX_STYLES = `
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1a1a1a;
         line-height: 1.5; padding: 48px 56px; max-width: 820px; margin: 0 auto; }
  h1 { font-size: 18pt; font-weight: 700; margin: 0 0 12px; }
  h2 { font-size: 14pt; font-weight: 600; margin: 20px 0 8px; }
  h3 { font-size: 12pt; font-weight: 600; margin: 16px 0 6px; }
  p  { margin: 4px 0 8px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 10pt; }
  th, td { border: 1px solid #b0b0b0; padding: 6px 10px; vertical-align: top; text-align: left; }
  th { background: #dbe5f1; font-weight: 700; }
  tr:nth-child(even) td { background: #f5f8fc; }
  mark { border-radius: 3px; padding: 1px 3px; }
  ::selection { background: rgba(59,130,246,0.3); }
`;

function DocViewer({ file, samples, onAddSample }: DocViewerProps) {
  const [docHtml, setDocHtml]         = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [loadErr, setLoadErr]         = useState<string | null>(null);
  const [popup, setPopup]             = useState<{ x: number; y: number; text: string } | null>(null);
  const [manualText, setManualText]   = useState('');
  const [manualLabel, setManualLabel] = useState<FieldLabel>('time');
  const [pdfPages, setPdfPages]       = useState<string[]>([]); // data URLs per page
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfRendering, setPdfRendering] = useState(false);
  const viewerRef                     = useRef<HTMLDivElement>(null);
  const iframeRef                     = useRef<HTMLIFrameElement>(null);
  const isPdf                         = file.name.toLowerCase().endsWith('.pdf');

  // ── Word doc: convert with mammoth, inject into sandboxed iframe ─────────
  useEffect(() => {
    if (isPdf) return;
    setLoading(true); setLoadErr(null); setDocHtml(null);
    const convert = () => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const mammoth = (window as any).mammoth;
          if (!mammoth) throw new Error('mammoth not loaded');
          const result = await mammoth.convertToHtml({ arrayBuffer: e.target!.result as ArrayBuffer });
          setDocHtml(result.value || '<p><em>(empty)</em></p>');
        } catch {
          setLoadErr('Could not render Word document — use manual entry below.');
        } finally { setLoading(false); }
      };
      reader.readAsArrayBuffer(file);
    };
    if ((window as any).mammoth) { convert(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
    s.onload = convert;
    s.onerror = () => { setLoadErr('Renderer unavailable — use manual entry.'); setLoading(false); };
    document.head.appendChild(s);
  }, [file, isPdf]);

  // ── PDF: render pages to canvas images via PDF.js ────────────────────────
  useEffect(() => {
    if (!isPdf) return;
    setLoading(true); setLoadErr(null); setPdfPages([]); setPdfRendering(true);

    const renderPdf = async (pdfjsLib: any) => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        setPdfPageCount(pdf.numPages);
        const pages: string[] = [];
        for (let p = 1; p <= Math.min(pdf.numPages, 20); p++) {
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width; canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
          pages.push(canvas.toDataURL('image/png'));
        }
        setPdfPages(pages);
      } catch {
        setLoadErr('Could not render PDF pages — use manual entry below.');
      } finally { setLoading(false); setPdfRendering(false); }
    };

    if ((window as any).pdfjsLib) {
      renderPdf((window as any).pdfjsLib);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      renderPdf((window as any).pdfjsLib);
    };
    s.onerror = () => { setLoadErr('PDF renderer unavailable — use manual entry.'); setLoading(false); setPdfRendering(false); };
    document.head.appendChild(s);
  }, [file, isPdf]);

  // ── Inject HTML into the Word iframe whenever content or samples change ───
  const fullDocHtml = React.useMemo(() => {
    if (!docHtml) return null;
    let body = docHtml;
    samples.forEach(s => {
      if (!s.text.trim()) return;
      const esc = s.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        body = body.replace(
          new RegExp(`(${esc})`, 'gi'),
          `<mark style="background:${LABEL_META[s.label].mark};" title="${LABEL_META[s.label].label}: $1">$1</mark>`
        );
      } catch {}
    });
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${DOCX_STYLES}</style></head><body>${body}</body></html>`;
  }, [docHtml, samples]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !fullDocHtml) return;
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open(); doc.write(fullDocHtml); doc.close();
  }, [fullDocHtml]);

  // ── Word iframe: intercept selection via postMessage ─────────────────────
  useEffect(() => {
    if (isPdf || !docHtml) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => {
      const idoc = iframe.contentDocument;
      if (!idoc) return;
      idoc.addEventListener('mouseup', (e: MouseEvent) => {
        const sel = idoc.getSelection();
        if (!sel || sel.isCollapsed) { setPopup(null); return; }
        const text = sel.toString().trim();
        if (!text || text.length > 300) { setPopup(null); return; }
        // Convert iframe coords to outer viewport
        const iRect = iframe.getBoundingClientRect();
        const vRect = viewerRef.current?.getBoundingClientRect();
        if (!vRect) return;
        setPopup({
          x: e.clientX + iRect.left - vRect.left,
          y: e.clientY + iRect.top  - vRect.top,
          text,
        });
      });
    };
    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [isPdf, docHtml]);

  const commitLabel = (label: FieldLabel) => {
    if (!popup) return;
    onAddSample(popup.text, label);
    setPopup(null);
    // Clear selection in iframe
    iframeRef.current?.contentDocument?.getSelection()?.removeAllRanges();
  };
  const dismissPopup = () => {
    setPopup(null);
    iframeRef.current?.contentDocument?.getSelection()?.removeAllRanges();
  };

  const addManual = () => {
    if (!manualText.trim()) return;
    onAddSample(manualText.trim(), manualLabel);
    setManualText('');
  };

  const VIEWER_H = 580;

  return (
    <div className="space-y-3">
      {/* Document viewer */}
      <div className="relative rounded-xl overflow-hidden border border-slate-600 bg-slate-950" ref={viewerRef} style={{ height: VIEWER_H }}>

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950 z-10">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-slate-400 text-sm">{isPdf ? 'Rendering PDF pages…' : 'Loading document…'}</span>
          </div>
        )}

        {loadErr && (
          <div className="absolute inset-0 flex items-center justify-center p-8 z-10">
            <div className="text-center space-y-2">
              <p className="text-red-300 text-sm">{loadErr}</p>
              <p className="text-slate-500 text-xs">Use manual entry below to add labels</p>
            </div>
          </div>
        )}

        {/* ── PDF: stacked canvas images (selectable text via overlay not needed — use manual) ── */}
        {isPdf && !loading && pdfPages.length > 0 && (
          <div className="h-full overflow-y-auto bg-slate-800 space-y-3 p-4">
            <div className="text-center text-slate-500 text-xs mb-2">
              {pdfPageCount > 20 ? `Showing first 20 of ${pdfPageCount} pages` : `${pdfPageCount} page${pdfPageCount !== 1 ? 's' : ''}`}
              {' · '}
              <span className="text-slate-400">Use <strong>manual entry</strong> below to label text from this PDF</span>
            </div>
            {pdfPages.map((src, i) => (
              <div key={i} className="mx-auto shadow-2xl" style={{ maxWidth: 760 }}>
                <div className="bg-slate-600 text-slate-400 text-xs px-3 py-1 rounded-t-md">Page {i + 1}</div>
                <img src={src} alt={`Page ${i+1}`} className="w-full block bg-white" draggable={false} />
              </div>
            ))}
          </div>
        )}

        {/* ── Word: sandboxed iframe with real table styles ── */}
        {!isPdf && !loading && !loadErr && (
          <>
            {popup && <div className="fixed inset-0 z-40" onClick={dismissPopup} />}
            <iframe
              ref={iframeRef}
              sandbox="allow-same-origin"
              className="w-full h-full bg-white border-0"
              title="Document preview"
            />
            {/* Selection popup — positioned relative to viewerRef */}
            {popup && (
              <div
                className="absolute z-50 bg-slate-900 border border-slate-600 rounded-xl shadow-2xl overflow-hidden"
                style={{
                  left: Math.min(popup.x + 10, (viewerRef.current?.offsetWidth ?? 600) - 260),
                  top:  Math.min(popup.y + 12, VIEWER_H - 160),
                  width: 248,
                }}
                onMouseDown={e => e.stopPropagation()}
              >
                <div className="px-3 py-2.5 bg-slate-800 border-b border-slate-700">
                  <p className="text-slate-400 text-xs">Label this as:</p>
                  <p className="text-white text-xs font-mono mt-0.5 truncate">
                    "{popup.text.slice(0,50)}{popup.text.length > 50 ? '…' : ''}"
                  </p>
                </div>
                {LABEL_KEYS.map(lbl => {
                  const m = LABEL_META[lbl];
                  return (
                    <button key={lbl} type="button" onClick={() => commitLabel(lbl)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-slate-700 border-b border-slate-800 last:border-0 transition-colors"
                    >
                      <span className={`w-2.5 h-2.5 rounded-full ${m.dot} shrink-0`} />
                      <span className="text-white font-medium">{m.emoji} {m.label}</span>
                      <span className="ml-auto text-slate-500 text-xs">{m.desc}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-slate-900/90 backdrop-blur-sm text-center text-slate-400 text-xs py-1.5 pointer-events-none">
              Select any text above → label it as Time, Segment, or Person
            </div>
          </>
        )}
      </div>

      {/* Manual entry — always shown, especially important for PDFs */}
      <div className={`border rounded-xl p-4 space-y-3 ${isPdf ? 'bg-slate-700/40 border-slate-500' : 'bg-slate-800/40 border-slate-700'}`}>
        <div className="flex items-start gap-2">
          {isPdf && <span className="text-lg mt-0.5">✍️</span>}
          <div>
            <p className="text-slate-300 text-sm font-medium">{isPdf ? 'Label text from the PDF' : 'Add label manually'}</p>
            <p className="text-slate-500 text-xs mt-0.5">
              {isPdf
                ? 'PDF text can\'t be highlighted directly — type exactly what you see above, e.g. "9:00 AM" or "Opening Keynote"'
                : 'Type an example exactly as it appears in the doc, then pick a label'
              }
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            value={manualText}
            onChange={e => setManualText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addManual()}
            placeholder={isPdf ? 'Type text exactly as shown in the document…' : 'e.g.  9:00 AM  or  Opening Remarks'}
            className="flex-1 min-w-48 px-3 py-2 bg-slate-900 text-white text-sm border border-slate-700 rounded-lg focus:ring-1 focus:ring-blue-500 placeholder-slate-600"
          />
          {LABEL_KEYS.map(lbl => {
            const m = LABEL_META[lbl];
            return (
              <button key={lbl} type="button" onClick={() => setManualLabel(lbl)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                  manualLabel === lbl ? `${m.activeBg} ${m.border} text-white` : 'bg-slate-700 border-slate-600 text-slate-400 hover:text-white'
                }`}
              >
                {m.emoji} {m.label}
              </button>
            );
          })}
          <button type="button" onClick={addManual} disabled={!manualText.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm rounded-lg font-medium">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Modal
// ─────────────────────────────────────────────────────────────────────────────

const AgendaImportModal: React.FC<AgendaImportModalProps> = ({
  isOpen, onClose, onImport, onDeleteAll,
}) => {
  const [file, setFile]                   = useState<File | null>(null);
  const [step, setStep]                   = useState<Step>('select');
  const [error, setError]                 = useState<string | null>(null);
  const [isExtracting, setIsExtracting]   = useState(false);
  const [rawLines, setRawLines]           = useState<string[]>([]);
  const [suggestedStart, setSuggestedStart] = useState(1);
  const [startFromLine, setStartFromLine] = useState('1');
  const [parsedData, setParsedData]       = useState<AgendaParsedRow[]>([]);
  const [excludedRows, setExcludedRows]   = useState<Set<number>>(new Set());
  const [showRawText, setShowRawText]     = useState(false);
  const [samples, setSamples]             = useState<FieldSample[]>([]);
  const [showSpeakerModal, setShowSpeakerModal]       = useState(false);
  const [editingSpeakersRow, setEditingSpeakersRow]   = useState<number | null>(null);
  const [tempSpeakers, setTempSpeakers]               = useState<SpeakerEdit[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const lineListRef  = useRef<HTMLDivElement>(null);
  const linesWithTimes = rawLines.length > 0 ? getLinesWithTimeIndices(rawLines) : [];

  // ── Reset ─────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setFile(null); setStep('select'); setError(null); setIsExtracting(false);
    setRawLines([]); setSuggestedStart(1); setStartFromLine('1');
    setParsedData([]); setExcludedRows(new Set()); setShowRawText(false); setSamples([]);
    setShowSpeakerModal(false); setEditingSpeakersRow(null); setTempSpeakers([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = () => { reset(); onClose(); };

  // ── File select ───────────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setError(null); setStep('select'); }
  };

  // ── Client-side text extraction (fallback when server unreachable) ────────
  const extractClientSide = useCallback(async (): Promise<string[]> => {
    if (!file) return [];
    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      // Word: use mammoth to get plain text
      const loadMammoth = (): Promise<any> => new Promise((res, rej) => {
        if ((window as any).mammoth) return res((window as any).mammoth);
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
        s.onload = () => res((window as any).mammoth);
        s.onerror = rej;
        document.head.appendChild(s);
      });
      const mammoth = await loadMammoth();
      const buf = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buf });
      const text: string = result.value || '';
      return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    }
    // PDF: use PDF.js to get text layer
    const loadPdfJs = (): Promise<any> => new Promise((res, rej) => {
      if ((window as any).pdfjsLib) return res((window as any).pdfjsLib);
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => {
        (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        res((window as any).pdfjsLib);
      };
      s.onerror = rej;
      document.head.appendChild(s);
    });
    const pdfjsLib = await loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const lines: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Group items into lines by Y position
      const byY: Map<number, string[]> = new Map();
      for (const item of content.items as any[]) {
        if (!item.str) continue;
        const y = Math.round(item.transform[5]);
        if (!byY.has(y)) byY.set(y, []);
        byY.get(y)!.push(item.str);
      }
      // Sort by descending Y (top of page first)
      const sorted = [...byY.entries()].sort((a, b) => b[0] - a[0]);
      for (const [, parts] of sorted) lines.push(parts.join('\t'));
      if (p < pdf.numPages) lines.push(''); // page break separator
    }
    return lines;
  }, [file]);

  // ── Extract ───────────────────────────────────────────────────────────────
  const handleExtract = useCallback(async () => {
    if (!file) return;
    setIsExtracting(true); setError(null);

    // Try server first
    let serverFailed = false;
    try {
      const apiBase = getApiBaseUrl();
      const url = `${apiBase}/api/parse-agenda?extractOnly=1`;
      const form = new FormData();
      form.append('file', file);
      if (samples.length > 0) {
        form.append('hints', JSON.stringify({
          timeExamples:    samples.filter(s => s.label === 'time').map(s => s.text),
          segmentExamples: samples.filter(s => s.label === 'segment').map(s => s.text),
          personExamples:  samples.filter(s => s.label === 'person').map(s => s.text),
        }));
      }

      let res: Response;
      try {
        res = await fetch(url, { method: 'POST', headers: authHeaders(), body: form });
      } catch (fetchErr: any) {
        // Network-level failure (CORS, server down, wrong URL)
        console.warn('[AgendaImport] Server fetch failed:', fetchErr?.message, '— trying client-side extraction');
        serverFailed = true;
        res = null as any;
      }

      if (!serverFailed) {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          const msg = j?.error || `Server error ${res.status}`;
          console.warn('[AgendaImport] Server returned error:', msg, '— trying client-side extraction');
          serverFailed = true;
        } else {
          const d = await res.json();
          let lines: string[] = Array.isArray(d.rawLines) ? d.rawLines : [];
          if (!lines.length && typeof d.rawText === 'string')
            lines = d.rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
          if (lines.length) {
            const suggested = typeof d.suggestedStartLineIndex === 'number' ? d.suggestedStartLineIndex + 1
              : typeof d.firstTimeLineIndex === 'number' ? d.firstTimeLineIndex + 1 : 1;
            const clamped = Math.max(1, Math.min(suggested, lines.length));
            setRawLines(lines); setSuggestedStart(clamped); setStartFromLine(String(clamped));
            setStep('lines');
            return;
          }
          // Server returned empty lines — fall through to client
          console.warn('[AgendaImport] Server returned no lines — trying client-side extraction');
          serverFailed = true;
        }
      }
    } catch (err) {
      console.warn('[AgendaImport] Unexpected error during server extract:', err);
      serverFailed = true;
    }

    // Client-side fallback
    if (serverFailed) {
      try {
        const lines = await extractClientSide();
        if (!lines.length) throw new Error('No text could be extracted from this file.');
        // Auto-suggest first line that looks like it has a time
        const firstTimeLine = lines.findIndex(l => /\b\d{1,2}:\d{2}\b/.test(l));
        const suggested = firstTimeLine >= 0 ? firstTimeLine + 1 : 1;
        setRawLines(lines); setSuggestedStart(suggested); setStartFromLine(String(suggested));
        setError(null);
        setStep('lines');
      } catch (clientErr: any) {
        setError(`Could not extract text: ${clientErr?.message || 'unknown error'}. Try a different file format.`);
      }
    }
  }, [file, samples, extractClientSide]);

  // ── Parse ─────────────────────────────────────────────────────────────────
  const handleParse = useCallback(() => {
    if (!rawLines.length) return;
    const n = parseInt(startFromLine.trim(), 10);
    const start = !isNaN(n) && n >= 1 ? n : suggestedStart;
    const idx = Math.max(0, Math.min(start - 1, rawLines.length - 1));
    const text = rawLines.slice(idx).join('\n');
    if (!text.trim()) { setError('No content from that start line.'); return; }
    setError(null);
    const hints: ParseHints = {
      timeExamples:    samples.filter(s => s.label === 'time').map(s => s.text),
      segmentExamples: samples.filter(s => s.label === 'segment').map(s => s.text),
      personExamples:  samples.filter(s => s.label === 'person').map(s => s.text),
    };
    const { items } = parseAgenda(text, 0, hints);
    setParsedData(items); setExcludedRows(new Set()); setStep('parse');
  }, [rawLines, startFromLine, suggestedStart]);

  // ── Samples ───────────────────────────────────────────────────────────────
  const addSample = useCallback((text: string, label: FieldLabel) => {
    if (!text.trim()) return;
    setSamples(prev => prev.some(s => s.text === text.trim() && s.label === label)
      ? prev : [...prev, { id: `s-${Date.now()}`, text: text.trim(), label }]);
  }, []);
  const removeSample = (id: string) => setSamples(prev => prev.filter(s => s.id !== id));

  // ── Row editing ───────────────────────────────────────────────────────────
  const updateRow = (index: number, field: keyof AgendaParsedRow, value: string | number | boolean) =>
    setParsedData(prev => { const n = [...prev]; if (n[index]) n[index] = { ...n[index], [field]: value }; return n; });

  const handleRecalcDurations = () => {
    setParsedData(rows => {
      const n = [...rows];
      for (let i = 0; i < n.length; i++) {
        const cur = parseTimeToMinutes(n[i].startTime ?? '');
        const nxt = i + 1 < n.length ? parseTimeToMinutes(n[i+1].startTime ?? '') : null;
        if (cur != null && nxt != null && nxt > cur) n[i] = { ...n[i], duration: minutesToHHMMSS(nxt - cur) };
      }
      return n;
    });
  };

  // ── Row exclusion ─────────────────────────────────────────────────────────
  const toggleExclude = (idx: number) =>
    setExcludedRows(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  const toggleAll = () =>
    setExcludedRows(excludedRows.size === parsedData.length ? new Set() : new Set(parsedData.map((_,i) => i)));

  // ── Import ────────────────────────────────────────────────────────────────
  const handleImport = () => {
    const toImport = parsedData.filter((_,i) => !excludedRows.has(i));
    if (!toImport.length) { setError('All rows excluded.'); return; }
    onImport(toImport); onClose();
  };

  const jumpToLine = useCallback((lineNum: number) => {
    setStartFromLine(String(lineNum));
    queueMicrotask(() => lineListRef.current?.querySelector(`[data-line="${lineNum}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }, []);

  // ── Speaker helpers ───────────────────────────────────────────────────────
  const openSpeakerModal = (rowIdx: number) => {
    const row = parsedData[rowIdx]; let list: SpeakerEdit[] = [];
    if (row?.speakers) {
      try {
        const raw = JSON.parse(row.speakers);
        list = (Array.isArray(raw) ? raw : [raw]).map((s: any, i: number) => ({
          id: s.id ?? `sp-${Date.now()}-${i}`, slot: typeof s.slot === 'number' ? s.slot : i+1,
          location: ['Podium','Seat','Virtual','Moderator'].includes(s.location) ? s.location : 'Seat',
          fullName: String(s.fullName ?? '').trim(), title: String(s.title ?? '').trim(),
          org: String(s.org ?? '').trim(), photoLink: String(s.photoLink ?? s.photoUrl ?? '').trim(),
        }));
      } catch {}
    }
    setTempSpeakers(list); setEditingSpeakersRow(rowIdx); setShowSpeakerModal(true);
  };
  const closeSpeakerModal = () => { setShowSpeakerModal(false); setEditingSpeakersRow(null); setTempSpeakers([]); };
  const addSpeaker = () => {
    if (tempSpeakers.length >= 7) return;
    const used = tempSpeakers.map(s => s.slot);
    const slot = [1,2,3,4,5,6,7].find(s => !used.includes(s)) ?? 1;
    setTempSpeakers(prev => [...prev, { id:`sp-${Date.now()}`, slot, location:'Seat', fullName:'', title:'', org:'', photoLink:'' }]);
  };
  const removeSpeaker = (id: string) => setTempSpeakers(prev => prev.filter(s => s.id !== id));
  const updateSpeaker = (id: string, field: keyof SpeakerEdit, value: string | number) =>
    setTempSpeakers(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  const updateSpeakerSlot = (id: string, newSlot: number) => {
    setTempSpeakers(prev => {
      const cur = prev.find(s => s.id === id); if (!cur) return prev;
      const taken = prev.find(s => s.id !== id && s.slot === newSlot);
      return prev.map(s => {
        if (s.id === id) return { ...s, slot: newSlot };
        if (taken && s.id === taken.id) return { ...s, slot: cur.slot };
        return s;
      });
    });
  };
  const saveSpeakers = () => {
    if (editingSpeakersRow == null) return;
    updateRow(editingSpeakersRow, 'speakers', JSON.stringify(
      tempSpeakers.map(({ id,slot,location,fullName,title,org,photoLink }) =>
        ({ id, slot, location, fullName, title, org, photoUrl: photoLink })
      )
    ));
    closeSpeakerModal();
  };

  if (!isOpen) return null;

  const stepOrder: Step[] = ['select','preview','lines','parse'];
  const stepLabels: Record<Step,string> = { select:'Upload', preview:'Label', lines:'Lines', parse:'Review' };
  const stepIdx = stepOrder.indexOf(step);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-5xl flex flex-col shadow-2xl overflow-hidden" style={{ maxHeight:'92vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-4 min-w-0">
            <h2 className="text-lg font-bold text-white shrink-0">Import Agenda</h2>
            <div className="hidden sm:flex items-center gap-1 text-xs">
              {stepOrder.map((s, i) => (
                <React.Fragment key={s}>
                  <span className={`px-2.5 py-1 rounded-full transition-colors ${
                    s === step ? 'bg-blue-600 text-white font-semibold'
                    : i < stepIdx ? 'text-slate-400' : 'text-slate-600'
                  }`}>{stepLabels[s]}</span>
                  {i < stepOrder.length - 1 && <span className="text-slate-700 mx-0.5">›</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
          <button onClick={handleClose} className="text-slate-400 hover:text-white text-2xl leading-none ml-4" type="button">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0 p-6 space-y-5">

          {error && (
            <div className="bg-red-900/40 border border-red-700 text-red-200 px-4 py-3 rounded-xl text-sm">
              ⚠ {error}
            </div>
          )}

          {/* ══ UPLOAD ═══════════════════════════════════════════════════════ */}
          {step === 'select' && (
            <div className="space-y-4">
              <div className="bg-red-900/20 border border-red-800/50 rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-red-400 font-semibold text-sm">Clear Existing Data</p>
                  <p className="text-slate-500 text-xs mt-0.5">Remove all schedule rows before importing</p>
                </div>
                <button onClick={() => window.confirm('Delete ALL? Cannot be undone.') && onDeleteAll()}
                  className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-sm font-medium rounded-lg" type="button">
                  Delete All Rows
                </button>
              </div>

              <div className="bg-slate-700/40 border border-slate-600 rounded-xl p-6 space-y-5">
                <div>
                  <p className="text-white font-semibold">Upload your agenda</p>
                  <p className="text-slate-400 text-sm mt-0.5">PDF or Word (.docx)</p>
                </div>
                <input ref={fileInputRef} type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-slate-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-500 file:cursor-pointer file:font-medium"
                />

                {file && (
                  <div className="space-y-4">
                    <p className="text-slate-300 text-sm flex items-center gap-2">
                      <span>📄</span> <strong>{file.name}</strong>
                      <span className="text-slate-500">({(file.size/1024).toFixed(1)} KB)</span>
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        onClick={() => { setSamples([]); setStep('preview'); }}
                        className="flex flex-col gap-2 px-5 py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-left transition-colors"
                        type="button"
                      >
                        <span className="text-2xl">👁️</span>
                        <span className="font-semibold text-base">Open Document Viewer</span>
                        <span className="text-blue-200 text-xs leading-relaxed">
                          See your document and highlight a time, a segment name, and a speaker — the parser will learn your format from those examples
                        </span>
                      </button>

                      <button
                        onClick={handleExtract}
                        disabled={isExtracting}
                        className="flex flex-col gap-2 px-5 py-5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white rounded-xl text-left transition-colors"
                        type="button"
                      >
                        <span className="text-2xl">⚡</span>
                        <span className="font-semibold text-base">{isExtracting ? 'Extracting…' : 'Quick Extract'}</span>
                        <span className="text-slate-300 text-xs leading-relaxed">
                          Skip straight to text extraction and parse — best for clean agendas with standard time formats
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══ DOCUMENT VIEWER + LABELING ═══════════════════════════════════ */}
          {step === 'preview' && file && (
            <div className="space-y-4">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <p className="text-white font-semibold">Highlight examples to guide the parser</p>
                  <p className="text-slate-400 text-sm mt-0.5">
                    Select text in the document → label it. Aim for at least one Time, one Segment Name, one Person.
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap shrink-0">
                  <button onClick={() => setStep('select')} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg" type="button">← Back</button>
                  <button onClick={handleExtract} disabled={isExtracting}
                    className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg" type="button">
                    {isExtracting ? 'Extracting…' : 'Extract & Parse →'}
                  </button>
                </div>
              </div>

              {/* Label counts */}
              <div className="flex flex-wrap gap-4 items-center">
                {LABEL_KEYS.map(lbl => {
                  const m = LABEL_META[lbl];
                  const count = samples.filter(s => s.label === lbl).length;
                  return (
                    <span key={lbl} className={`flex items-center gap-2 text-sm ${count > 0 ? m.text : 'text-slate-600'}`}>
                      <span className={`w-2.5 h-2.5 rounded-full ${count > 0 ? m.dot : 'bg-slate-700'}`} />
                      {m.label}
                      {count > 0 && (
                        <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${m.bg} ${m.border} border`}>{count}</span>
                      )}
                    </span>
                  );
                })}
                {samples.length > 0 && (
                  <button onClick={() => setSamples([])} className="text-slate-600 hover:text-red-400 text-xs ml-auto" type="button">Clear all</button>
                )}
              </div>

              {/* Sample chips */}
              {samples.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {samples.map(s => {
                    const m = LABEL_META[s.label];
                    return (
                      <span key={s.id} className={`inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full border text-xs font-medium ${m.bg} ${m.border} ${m.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${m.dot} shrink-0`} />
                        {m.emoji} {s.text}
                        <button type="button" onClick={() => removeSample(s.id)}
                          className="ml-0.5 w-4 h-4 rounded-full flex items-center justify-center hover:bg-white/20 opacity-60 hover:opacity-100 text-xs">×</button>
                      </span>
                    );
                  })}
                </div>
              )}

              <DocViewer file={file} samples={samples} onAddSample={addSample} />
            </div>
          )}

          {/* ══ LINE PICKER ═══════════════════════════════════════════════════ */}
          {step === 'lines' && rawLines.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <p className="text-white font-semibold">Set parse start line</p>
                  <p className="text-slate-400 text-sm mt-0.5">
                    Click any line to start parsing from there. Suggested: line <strong className="text-white">{suggestedStart}</strong>.
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap shrink-0">
                  <button onClick={() => setStep('preview')} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg" type="button">← Label doc</button>
                  <button onClick={reset} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg" type="button">New file</button>
                  <button onClick={handleParse} className="px-6 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg" type="button">Parse →</button>
                </div>
              </div>

              {/* Samples summary */}
              {samples.length > 0 && (
                <div className="flex flex-wrap gap-2 p-3 bg-slate-900/50 rounded-xl border border-slate-700">
                  <span className="text-slate-500 text-xs self-center shrink-0">Labels used:</span>
                  {samples.map(s => {
                    const m = LABEL_META[s.label];
                    return (
                      <span key={s.id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${m.bg} ${m.border} ${m.text}`}>
                        {m.emoji} <span className="font-mono">{s.text}</span>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Time jumpers */}
              {linesWithTimes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-slate-500 text-xs uppercase tracking-wider font-medium">Jump to line with time</p>
                  <div className="flex flex-wrap gap-2">
                    {linesWithTimes.map(({ lineNumber, preview }) => (
                      <button key={lineNumber} type="button" onClick={() => jumpToLine(lineNumber)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                          parseInt(startFromLine) === lineNumber
                            ? 'bg-amber-600 border-amber-400 text-white'
                            : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600 hover:text-white'
                        }`}>
                        <span className="text-amber-400/80">{lineNumber}</span>
                        <span className="mx-1 text-slate-600">·</span>
                        <span className="truncate max-w-36 inline-block align-bottom">{preview}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Start line input */}
              <div className="flex items-center gap-3">
                <label className="text-slate-400 text-sm shrink-0">Start from line:</label>
                <input type="number" min={1} max={rawLines.length} value={startFromLine}
                  onChange={e => setStartFromLine(e.target.value)}
                  className="w-20 px-2 py-1.5 bg-slate-900 text-white text-sm border border-slate-700 rounded-lg focus:ring-1 focus:ring-amber-500" />
                <span className="text-slate-600 text-sm">of {rawLines.length}</span>
              </div>

              {/* Line list */}
              <div ref={lineListRef} className="border border-slate-700 rounded-xl bg-slate-900 overflow-auto" style={{ maxHeight: 400 }}>
                <table className="w-full text-xs font-mono border-collapse">
                  <tbody>
                    {rawLines.map((line, i) => {
                      const lineNum = i + 1;
                      const isStart = parseInt(startFromLine) === lineNum;
                      const hasTime = linesWithTimes.some(t => t.lineNumber === lineNum);
                      const isEmpty = !line.trim();
                      const matched = samples.filter(s => line.toLowerCase().includes(s.text.toLowerCase()));
                      return (
                        <tr key={i} data-line={lineNum} onClick={() => setStartFromLine(String(lineNum))}
                          className={`border-b border-slate-800/50 cursor-pointer transition-colors ${
                            isStart ? 'bg-amber-600/20' : isEmpty ? '' : 'hover:bg-slate-800/50'
                          }`}
                        >
                          <td className="px-3 py-1 text-right select-none w-10 border-r border-slate-800 align-top">
                            <span className={isStart ? 'text-amber-400 font-bold' : 'text-slate-700'}>{lineNum}</span>
                          </td>
                          <td className="px-3 py-1 align-top">
                            {isEmpty
                              ? <span className="text-slate-800">·</span>
                              : <span className={isStart ? 'text-amber-100' : hasTime ? 'text-slate-200' : 'text-slate-400'}>
                                  {hasTime && <span className="mr-1.5 text-amber-500/50">⏱</span>}
                                  {line}
                                </span>
                            }
                          </td>
                          {matched.length > 0 && (
                            <td className="px-3 py-1 align-top text-right whitespace-nowrap">
                              {matched.map(s => {
                                const m = LABEL_META[s.label];
                                return (
                                  <span key={s.id} className={`inline-flex items-center ml-1 px-1.5 py-0.5 rounded border text-xs ${m.bg} ${m.border} ${m.text}`} title={`${m.label}: "${s.text}"`}>
                                    {m.emoji}
                                  </span>
                                );
                              })}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'lines' && rawLines.length === 0 && (
            <div className="bg-amber-900/30 border border-amber-700 rounded-xl p-4 space-y-3">
              <p className="text-amber-200 text-sm">No lines extracted. Try another file.</p>
              <button onClick={reset} className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm" type="button">Start over</button>
            </div>
          )}

          {/* ══ PARSE RESULTS ════════════════════════════════════════════════ */}
          {step === 'parse' && parsedData.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-white font-semibold">
                    Review — {parsedData.length - excludedRows.size} of {parsedData.length} rows selected
                  </p>
                  <p className="text-slate-400 text-xs mt-0.5">Toggle ✓/✗ per row · edit any field inline</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {excludedRows.size > 0 && (
                    <button onClick={() => setExcludedRows(new Set())} className="text-xs text-blue-400 hover:text-blue-300" type="button">Include all</button>
                  )}
                  <button onClick={() => setStep('lines')} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg" type="button">← Lines</button>
                  <button onClick={handleRecalcDurations} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg" type="button">Recalc durations</button>
                  <button onClick={handleImport}
                    className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg text-sm" type="button">
                    Import {parsedData.length - excludedRows.size} item{parsedData.length - excludedRows.size !== 1 ? 's' : ''}
                    {excludedRows.size > 0 && <span className="ml-1.5 opacity-70 text-xs">({excludedRows.size} excluded)</span>}
                  </button>
                </div>
              </div>

              <div className="border border-slate-700 rounded-xl bg-slate-900 overflow-auto" style={{ maxHeight: 460 }}>
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-700">
                    <tr>
                      <th className="px-2 py-2 w-10 border-r border-slate-600">
                        <button type="button" onClick={toggleAll}
                          className="w-5 h-5 rounded border border-slate-400 bg-slate-600 hover:bg-slate-500 flex items-center justify-center text-xs text-white mx-auto">
                          {excludedRows.size === parsedData.length ? '−' : '✓'}
                        </button>
                      </th>
                      {['#','Start','Segment Name','Duration','Program Type','Speakers'].map(h => (
                        <th key={h} className="px-2 py-2 text-left text-slate-300 text-xs font-semibold border-r border-slate-600 last:border-r-0">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.map((r, idx) => (
                      <tr key={idx} className={`border-t border-slate-800 transition-opacity ${excludedRows.has(idx) ? 'opacity-30' : 'hover:bg-slate-800/30'}`}>
                        <td className="px-2 py-1.5 border-r border-slate-800 text-center">
                          <button type="button" onClick={() => toggleExclude(idx)}
                            className={`w-5 h-5 rounded border flex items-center justify-center text-xs mx-auto transition-colors ${
                              excludedRows.has(idx)
                                ? 'bg-red-800/50 border-red-600 text-red-300'
                                : 'bg-green-700/30 border-green-600 text-green-300 hover:bg-red-800/30 hover:border-red-600'
                            }`}>
                            {excludedRows.has(idx) ? '✗' : '✓'}
                          </button>
                        </td>
                        <td className="px-2 py-1.5 text-slate-500 border-r border-slate-800 text-xs">{r.row}</td>
                        <td className="px-2 py-1.5 border-r border-slate-800">
                          <input value={r.startTime ?? ''} onChange={e => updateRow(idx,'startTime',e.target.value)}
                            placeholder="9:00 AM" className="w-full px-1.5 py-0.5 bg-slate-800 text-white text-xs border border-slate-700 rounded focus:ring-1 focus:ring-amber-500" />
                        </td>
                        <td className="px-2 py-1.5 border-r border-slate-800">
                          <input value={r.segmentName} onChange={e => updateRow(idx,'segmentName',e.target.value)}
                            className="w-full px-1.5 py-0.5 bg-slate-800 text-white text-xs border border-slate-700 rounded focus:ring-1 focus:ring-blue-500" />
                        </td>
                        <td className="px-2 py-1.5 border-r border-slate-800">
                          <input value={r.duration} onChange={e => updateRow(idx,'duration',e.target.value)}
                            placeholder="HH:MM:SS" className="w-full px-1.5 py-0.5 bg-slate-800 text-white text-xs border border-slate-700 rounded" />
                        </td>
                        <td className="px-2 py-1.5 border-r border-slate-800">
                          <select value={r.programType||''} onChange={e => updateRow(idx,'programType',e.target.value)}
                            className="w-full px-1.5 py-0.5 bg-slate-800 text-white text-xs border border-slate-700 rounded"
                            style={r.programType && PROGRAM_TYPE_COLORS[r.programType]
                              ? { backgroundColor: PROGRAM_TYPE_COLORS[r.programType], color: r.programType === 'Sub Cue' ? '#000' : '#fff' }
                              : undefined}>
                            <option value="">—</option>
                            {PROGRAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500 text-xs">
                              {r.speakers ? (() => { try { const a=JSON.parse(r.speakers); return `${Array.isArray(a)?a.length:0}×`; } catch { return '—'; } })() : '—'}
                            </span>
                            <button type="button" onClick={() => openSpeakerModal(idx)} className="text-blue-400 hover:text-blue-300 text-xs underline">Edit</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-center">
                <button onClick={reset} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg" type="button">Import another file</button>
              </div>
            </div>
          )}

          {step === 'parse' && parsedData.length === 0 && rawLines.length > 0 && (
            <div className="bg-amber-900/30 border border-amber-700 rounded-xl p-4 space-y-3">
              <p className="text-amber-200 text-sm">Nothing parsed. Try a different start line or add more highlight labels.</p>
              <div className="flex gap-3">
                <button onClick={() => setStep('lines')} className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm" type="button">← Lines</button>
                <button onClick={() => setStep('preview')} className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg text-sm" type="button">Add labels</button>
              </div>
            </div>
          )}

        </div>{/* /body */}
      </div>{/* /card */}

      {/* ── Speaker Modal ─────────────────────────────────────────────────────── */}
      {showSpeakerModal && editingSpeakersRow !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-slate-800 rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex justify-between items-center p-4 border-b border-slate-700">
              <h3 className="text-lg font-bold text-white">Speakers — {parsedData[editingSpeakersRow]?.segmentName||'Item'}</h3>
              <button type="button" onClick={closeSpeakerModal} className="text-slate-400 hover:text-white text-xl">×</button>
            </div>
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              <button type="button" onClick={addSpeaker} disabled={tempSpeakers.length>=7}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg">
                + Add speaker {tempSpeakers.length < 7 && `(${7-tempSpeakers.length} left)`}
              </button>
              {tempSpeakers.length === 0 && <p className="text-slate-400 text-sm">No speakers yet.</p>}
              {[...tempSpeakers].sort((a,b)=>a.slot-b.slot).map(s => (
                <div key={s.id} className="bg-slate-700 rounded-xl p-4 border border-slate-600 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-white font-medium text-sm">Speaker {s.slot}</span>
                    <button type="button" onClick={() => removeSpeaker(s.id)} className="w-7 h-7 bg-red-700 hover:bg-red-600 text-white rounded-lg flex items-center justify-center text-sm">×</button>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Slot</label>
                      <select value={s.slot} onChange={e => updateSpeakerSlot(s.id, parseInt(e.target.value))} className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm">
                        {[1,2,3,4,5,6,7].map(n => {
                          const used = tempSpeakers.some(x => x.id!==s.id && x.slot===n);
                          return <option key={n} value={n}>{n}{used?' (used)':''}</option>;
                        })}
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Location</label>
                      <select value={s.location} onChange={e => updateSpeaker(s.id,'location',e.target.value as SpeakerLocation)} className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm">
                        {(['Podium','Seat','Moderator','Virtual'] as SpeakerLocation[]).map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2 lg:col-span-1">
                      <label className="block text-slate-400 text-xs mb-1">Full name</label>
                      <input value={s.fullName} onChange={e => updateSpeaker(s.id,'fullName',e.target.value)} placeholder="Full name" className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-500" />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Title</label>
                      <input value={s.title} onChange={e => updateSpeaker(s.id,'title',e.target.value)} placeholder="Title" className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-500" />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Organization</label>
                      <input value={s.org} onChange={e => updateSpeaker(s.id,'org',e.target.value)} placeholder="Org" className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-500" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-slate-400 text-xs mb-1">Photo URL</label>
                      <div className="flex gap-2 items-center">
                        <input type="url" value={s.photoLink} onChange={e => updateSpeaker(s.id,'photoLink',e.target.value)} placeholder="https://…" className="flex-1 px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-500" />
                        {s.photoLink && <img src={s.photoLink} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-500" onError={e=>{(e.target as HTMLImageElement).style.display='none';}} />}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-700 p-4 flex gap-3">
              <button type="button" onClick={saveSpeakers} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl">Save & close</button>
              <button type="button" onClick={closeSpeakerModal} className="flex-1 py-2 bg-slate-600 hover:bg-slate-500 text-white font-medium rounded-xl">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgendaImportModal;
