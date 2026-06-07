import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEMO_AGENDA_DOC_LINES,
  DEMO_AGENDA_FILE,
  DEMO_AGENDA_HIGHLIGHT_STEPS,
  DEMO_AGENDA_PARSE_START_LINE,
  DEMO_AGENDA_PARSED_ROWS,
  DEMO_AGENDA_TABLE_ROWS,
} from './demoData';
import { PROGRAM_TYPE_COLORS } from './showcaseConstants';
import { ShowcaseFakeCursor, showcaseTargetPoint, waitMs } from './ShowcaseFakeCursor';

type Step = 'select' | 'preview' | 'lines' | 'parse';
type FieldLabel = 'time' | 'segment' | 'person';

type ActiveSample = (typeof DEMO_AGENDA_HIGHLIGHT_STEPS)[number];

const LABEL_META: Record<
  FieldLabel,
  {
    emoji: string;
    label: string;
    desc: string;
    bg: string;
    border: string;
    text: string;
    dot: string;
    mark: string;
  }
> = {
  time: {
    emoji: '⏱',
    label: 'Time',
    desc: 'Start time',
    bg: 'bg-amber-500/15',
    border: 'border-amber-500',
    text: 'text-amber-200',
    dot: 'bg-amber-400',
    mark: 'rgba(251,191,36,0.38)',
  },
  segment: {
    emoji: '📌',
    label: 'Segment Name',
    desc: 'Session title',
    bg: 'bg-blue-500/15',
    border: 'border-blue-500',
    text: 'text-blue-200',
    dot: 'bg-blue-400',
    mark: 'rgba(96,165,250,0.38)',
  },
  person: {
    emoji: '🎤',
    label: 'Person',
    desc: 'Speaker name',
    bg: 'bg-green-500/15',
    border: 'border-green-500',
    text: 'text-green-200',
    dot: 'bg-green-400',
    mark: 'rgba(74,222,128,0.38)',
  },
};

const STEP_ORDER: Step[] = ['select', 'preview', 'lines', 'parse'];
const STEP_LABELS: Record<Step, string> = {
  select: 'Upload',
  preview: 'Label',
  lines: 'Lines',
  parse: 'Review',
};

const PROGRAM_TYPES = [
  'PreShow/End',
  'Podium Transition',
  'Panel Transition',
  'Full-Stage/Ted-Talk',
  'Break F&B/B2B',
  'Video',
];

function cellKey(rowIndex: number, field: string) {
  return `${rowIndex}-${field}`;
}

function renderMarked(text: string, label: FieldLabel) {
  const m = LABEL_META[label];
  return (
    <mark
      style={{
        backgroundColor: m.mark,
        borderRadius: 3,
        padding: '1px 3px',
      }}
    >
      {text}
    </mark>
  );
}

function renderCellWithMarks(value: string, marks: { text: string; label: FieldLabel }[]) {
  if (marks.length === 0) return value;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  const sorted = [...marks].sort((a, b) => value.indexOf(a.text) - value.indexOf(b.text));
  for (const m of sorted) {
    const start = value.indexOf(m.text, cursor);
    if (start === -1) continue;
    if (start > cursor) parts.push(value.slice(cursor, start));
    parts.push(<React.Fragment key={`${m.text}-${start}`}>{renderMarked(m.text, m.label)}</React.Fragment>);
    cursor = start + m.text.length;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts.length > 0 ? parts : value;
}

function MockDocViewer({
  samples,
  highlightPopup,
  cellRefs,
  className = '',
}: {
  samples: ActiveSample[];
  highlightPopup: { text: string } | null;
  cellRefs: React.MutableRefObject<Record<string, HTMLSpanElement | null>>;
  className?: string;
}) {
  const cellMarks = useMemo(() => {
    const map = new Map<string, { text: string; label: FieldLabel }[]>();
    for (const s of samples) {
      const key = cellKey(s.rowIndex, s.field);
      const list = map.get(key) ?? [];
      list.push({ text: s.text, label: s.label });
      map.set(key, list);
    }
    return map;
  }, [samples]);

  return (
    <div
      className={`relative rounded-xl overflow-hidden border border-slate-600 bg-slate-950 flex flex-col min-h-[140px] ${className}`}
    >
      <div className="flex-1 min-h-0 overflow-y-auto bg-white text-[#1a1a1a] font-[Calibri,'Segoe_UI',Arial,sans-serif] text-[11px] leading-relaxed px-5 py-4">
        <h1 className="text-[14pt] font-bold m-0 mb-2">Annual Leadership Summit</h1>
        <p className="text-[10pt] text-[#444] m-0 mb-3">June 15, 2026 · Great Hall · Master start 9:00 AM</p>
        <table className="w-full border-collapse text-[10pt]">
          <thead>
            <tr>
              {['Time', 'Session', 'Presenter'].map((h) => (
                <th
                  key={h}
                  className="border border-[#b0b0b0] px-2 py-1 text-left font-bold bg-[#dbe5f1]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DEMO_AGENDA_TABLE_ROWS.map((row, rowIndex) => (
              <tr key={rowIndex} className={rowIndex % 2 === 1 ? 'bg-[#f5f8fc]' : undefined}>
                {(['time', 'session', 'presenter'] as const).map((field) => {
                  const key = cellKey(rowIndex, field);
                  const value = row[field];
                  const marks = cellMarks.get(key) ?? [];
                  const isPopupTarget = highlightPopup?.text && value.includes(highlightPopup.text);
                  return (
                    <td key={field} className="border border-[#b0b0b0] px-2 py-1 align-top">
                      <span
                        ref={(el) => {
                          cellRefs.current[key] = el;
                        }}
                        className={isPopupTarget ? 'bg-blue-100/80 rounded-sm' : undefined}
                      >
                        {renderCellWithMarks(value, marks)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="absolute bottom-0 left-0 right-0 bg-slate-900/90 backdrop-blur-sm text-center text-slate-400 text-[10px] py-1 pointer-events-none">
        Select any text above → label it as Time, Segment, or Person
      </div>
    </div>
  );
}

export const AgendaShowcaseContent: React.FC = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const docViewerBtnRef = useRef<HTMLSpanElement>(null);
  const extractBtnRef = useRef<HTMLSpanElement>(null);
  const parseBtnRef = useRef<HTMLSpanElement>(null);
  const importBtnRef = useRef<HTMLSpanElement>(null);
  const startLineRowRef = useRef<HTMLTableRowElement>(null);
  const cellRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const labelBtnRefs = useRef<Record<FieldLabel, HTMLButtonElement | null>>({
    time: null,
    segment: null,
    person: null,
  });

  const [step, setStep] = useState<Step>('select');
  const [samples, setSamples] = useState<ActiveSample[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [startFromLine, setStartFromLine] = useState(String(DEMO_AGENDA_PARSE_START_LINE));
  const [labelPopup, setLabelPopup] = useState<{ text: string; x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState({ x: 420, y: 280, visible: false, clicking: false });
  const demoRunningRef = useRef(false);

  const linesWithTimes = useMemo(
    () =>
      DEMO_AGENDA_DOC_LINES.map((line, i) => ({ line, lineNumber: i + 1 })).filter(({ line }) =>
        /\b\d{1,2}:\d{2}\b/.test(line)
      ),
    []
  );

  const moveTo = useCallback(async (el: HTMLElement | null, click = false) => {
    if (!el) return;
    const pt = showcaseTargetPoint(el, rootRef.current, { anchor: click ? 'center' : 'tap' });
    setCursor((c) => ({ ...c, x: pt.x, y: pt.y, visible: true, clicking: false }));
    await waitMs(400);
    if (click) {
      setCursor((c) => ({ ...c, clicking: true }));
      await waitMs(180);
      setCursor((c) => ({ ...c, clicking: false }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const reset = () => {
      setStep('select');
      setSamples([]);
      setIsExtracting(false);
      setStartFromLine(String(DEMO_AGENDA_PARSE_START_LINE));
      setLabelPopup(null);
      setCursor((c) => ({ ...c, visible: false, clicking: false }));
    };

    const run = async () => {
      if (demoRunningRef.current) return;
      demoRunningRef.current = true;

      reset();
      await waitMs(1000);
      if (cancelled) return;

      setCursor((c) => ({ ...c, visible: true }));
      await moveTo(docViewerBtnRef.current, true);
      if (cancelled) return;
      setStep('preview');
      await waitMs(600);

      for (const highlight of DEMO_AGENDA_HIGHLIGHT_STEPS) {
        if (cancelled) break;
        const key = cellKey(highlight.rowIndex, highlight.field);
        const cellEl = cellRefs.current[key];
        const pt = cellEl ? showcaseTargetPoint(cellEl, rootRef.current, { anchor: 'tap' }) : { x: 420, y: 280 };
        setLabelPopup({ text: highlight.text, x: pt.x, y: pt.y });
        await moveTo(cellEl);
        await waitMs(350);
        const labelBtn = labelBtnRefs.current[highlight.label];
        await moveTo(labelBtn, true);
        setLabelPopup(null);
        setSamples((prev) => [...prev, highlight]);
        await waitMs(500);
      }

      if (cancelled) return;
      await moveTo(extractBtnRef.current, true);
      setIsExtracting(true);
      await waitMs(1200);
      if (cancelled) return;
      setIsExtracting(false);
      setStep('lines');
      await waitMs(700);

      setStartFromLine(String(DEMO_AGENDA_PARSE_START_LINE));
      await moveTo(startLineRowRef.current);
      await waitMs(400);
      await moveTo(parseBtnRef.current, true);
      if (cancelled) return;
      setStep('parse');
      setCursor((c) => ({ ...c, visible: false }));
      await waitMs(5500);
      if (cancelled) return;

      reset();
      demoRunningRef.current = false;
      await waitMs(900);
      if (!cancelled) run();
    };

    run();

    return () => {
      cancelled = true;
      demoRunningRef.current = false;
    };
  }, [moveTo]);

  const stepIdx = STEP_ORDER.indexOf(step);
  const parsedCount = DEMO_AGENDA_PARSED_ROWS.length;

  return (
    <div ref={rootRef} className="relative w-full h-full overflow-hidden bg-black/70 flex flex-col p-6 box-border">
      <ShowcaseFakeCursor
        x={cursor.x}
        y={cursor.y}
        visible={cursor.visible}
        clicking={cursor.clicking}
        moveMs={400}
      />

      <div className="relative w-full flex-1 min-h-0 max-w-5xl mx-auto bg-slate-800 rounded-2xl shadow-2xl border border-slate-600 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-lg font-bold text-white shrink-0">Import Agenda</h2>
            <div className="flex items-center gap-1 text-xs">
              {STEP_ORDER.map((s, i) => (
                <React.Fragment key={s}>
                  <span
                    className={`px-2.5 py-1 rounded-full transition-colors duration-300 ${
                      s === step
                        ? 'bg-blue-600 text-white font-semibold'
                        : i < stepIdx
                          ? 'text-slate-400'
                          : 'text-slate-600'
                    }`}
                  >
                    {STEP_LABELS[s]}
                  </span>
                  {i < STEP_ORDER.length - 1 && <span className="text-slate-700 mx-0.5">›</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
          <span className="text-slate-500 text-xl leading-none">×</span>
        </div>

        <div className="px-6 pb-6 pt-4 flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Upload */}
          {step === 'select' && (
            <div className="flex flex-col flex-1 min-h-0 justify-center">
              <div className="bg-slate-700/40 border border-slate-600 rounded-xl p-5 space-y-4">
                <div>
                  <p className="text-white font-semibold text-sm">Upload your agenda</p>
                  <p className="text-slate-400 text-xs mt-0.5">PDF or Word (.docx)</p>
                </div>
                <div className="block w-full text-xs text-slate-400 px-3 py-2 bg-slate-900/50 rounded-lg border border-slate-700">
                  Choose file — Summit_Agenda_Draft.docx
                </div>
                <p className="text-slate-300 text-xs flex items-center gap-2">
                  <span>📄</span>
                  <strong>{DEMO_AGENDA_FILE.name}</strong>
                  <span className="text-slate-500">({DEMO_AGENDA_FILE.sizeKb} KB)</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <span
                    ref={docViewerBtnRef}
                    className="flex flex-col gap-1.5 px-4 py-4 bg-blue-600 text-white rounded-xl text-left ring-2 ring-blue-400/60"
                  >
                    <span className="text-xl">👁️</span>
                    <span className="font-semibold text-sm">Open Document Viewer</span>
                    <span className="text-blue-200 text-[10px] leading-snug">
                      See your document and highlight a time, segment, and speaker
                    </span>
                  </span>
                  <span className="flex flex-col gap-1.5 px-4 py-4 bg-slate-600 text-white rounded-xl text-left opacity-70">
                    <span className="text-xl">⚡</span>
                    <span className="font-semibold text-sm">Quick Extract</span>
                    <span className="text-slate-300 text-[10px] leading-snug">
                      Skip to text extraction for clean agendas
                    </span>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Document viewer + labeling */}
          {step === 'preview' && (
            <div className="flex flex-col flex-1 min-h-0 gap-3 overflow-hidden">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <p className="text-white font-semibold text-sm">Highlight examples to guide the parser</p>
                  <p className="text-slate-400 text-[10px] mt-0.5">
                    Select text in the document → label it. Aim for Time, Segment Name, and Person.
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <span className="px-3 py-1.5 bg-slate-700 text-white text-xs rounded-lg">← Back</span>
                  <span
                    ref={extractBtnRef}
                    className={`px-4 py-1.5 text-white text-xs font-semibold rounded-lg ${
                      isExtracting ? 'bg-amber-500/70 animate-pulse' : 'bg-amber-600'
                    }`}
                  >
                    {isExtracting ? 'Extracting…' : 'Extract & Parse →'}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 items-center">
                {(['time', 'segment', 'person'] as const).map((lbl) => {
                  const m = LABEL_META[lbl];
                  const count = samples.filter((s) => s.label === lbl).length;
                  return (
                    <span key={lbl} className={`flex items-center gap-1.5 text-xs ${count > 0 ? m.text : 'text-slate-600'}`}>
                      <span className={`w-2 h-2 rounded-full ${count > 0 ? m.dot : 'bg-slate-700'}`} />
                      {m.label}
                      {count > 0 && (
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${m.bg} ${m.border} border`}>
                          {count}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>

              {samples.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {samples.map((s) => {
                    const m = LABEL_META[s.label];
                    return (
                      <span
                        key={s.id}
                        className={`inline-flex items-center gap-1 pl-2 pr-2 py-0.5 rounded-full border text-[10px] font-medium ${m.bg} ${m.border} ${m.text}`}
                      >
                        {m.emoji} {s.text}
                      </span>
                    );
                  })}
                </div>
              )}

              <MockDocViewer
                samples={samples}
                highlightPopup={labelPopup}
                cellRefs={cellRefs}
                className="flex-1 min-h-0"
              />
            </div>
          )}

          {/* Line picker */}
          {step === 'lines' && (
            <div className="flex flex-col flex-1 min-h-0 gap-3 overflow-hidden">
              <div className="flex items-start justify-between flex-wrap gap-2">
                <div>
                  <p className="text-white font-semibold text-sm">Set parse start line</p>
                  <p className="text-slate-400 text-[10px] mt-0.5">
                    Click any line to start parsing. Suggested: line{' '}
                    <strong className="text-white">{DEMO_AGENDA_PARSE_START_LINE}</strong>.
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <span className="px-3 py-1.5 bg-slate-700 text-white text-xs rounded-lg">← Label doc</span>
                  <span
                    ref={parseBtnRef}
                    className="px-4 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg"
                  >
                    Parse →
                  </span>
                </div>
              </div>

              {samples.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2 bg-slate-900/50 rounded-xl border border-slate-700">
                  <span className="text-slate-500 text-[10px] self-center shrink-0">Labels used:</span>
                  {samples.map((s) => {
                    const m = LABEL_META[s.label];
                    return (
                      <span
                        key={s.id}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] ${m.bg} ${m.border} ${m.text}`}
                      >
                        {m.emoji} <span className="font-mono">{s.text}</span>
                      </span>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {linesWithTimes.slice(0, 4).map(({ lineNumber, line }) => (
                  <span
                    key={lineNumber}
                    className={`px-2 py-1 rounded-lg text-[10px] font-mono border ${
                      parseInt(startFromLine) === lineNumber
                        ? 'bg-amber-600 border-amber-400 text-white'
                        : 'bg-slate-700 border-slate-600 text-slate-300'
                    }`}
                  >
                    <span className="text-amber-400/80">{lineNumber}</span>
                    <span className="mx-1 text-slate-600">·</span>
                    <span className="truncate max-w-[120px] inline-block align-bottom">
                      {line.split('\t')[0] || line.slice(0, 24)}
                    </span>
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400 shrink-0">Start from line:</span>
                <span className="w-14 px-2 py-1 bg-slate-900 text-white text-xs border border-slate-700 rounded-lg">
                  {startFromLine}
                </span>
                <span className="text-slate-600">of {DEMO_AGENDA_DOC_LINES.length}</span>
              </div>

              <div className="flex-1 min-h-0 border border-slate-700 rounded-xl bg-slate-900 overflow-auto">
                <table className="w-full text-[10px] font-mono border-collapse">
                  <tbody>
                    {DEMO_AGENDA_DOC_LINES.map((line, i) => {
                      const lineNum = i + 1;
                      const isStart = parseInt(startFromLine) === lineNum;
                      const hasTime = /\b\d{1,2}:\d{2}\b/.test(line);
                      const isEmpty = !line.trim();
                      const matched = samples.filter((s) => line.toLowerCase().includes(s.text.toLowerCase()));
                      return (
                        <tr
                          key={i}
                          ref={lineNum === DEMO_AGENDA_PARSE_START_LINE ? startLineRowRef : undefined}
                          className={`border-b border-slate-800/50 ${
                            isStart ? 'bg-amber-600/20' : isEmpty ? '' : 'hover:bg-slate-800/30'
                          }`}
                        >
                          <td className="px-2 py-0.5 text-right select-none w-8 border-r border-slate-800 align-top">
                            <span className={isStart ? 'text-amber-400 font-bold' : 'text-slate-700'}>{lineNum}</span>
                          </td>
                          <td className="px-2 py-0.5 align-top">
                            {isEmpty ? (
                              <span className="text-slate-800">·</span>
                            ) : (
                              <span className={isStart ? 'text-amber-100' : hasTime ? 'text-slate-200' : 'text-slate-400'}>
                                {hasTime && <span className="mr-1 text-amber-500/50">⏱</span>}
                                {line.replace(/\t/g, '  ·  ')}
                              </span>
                            )}
                          </td>
                          {matched.length > 0 && (
                            <td className="px-2 py-0.5 align-top text-right whitespace-nowrap">
                              {matched.map((s) => {
                                const m = LABEL_META[s.label];
                                return (
                                  <span
                                    key={s.id}
                                    className={`inline-flex items-center ml-1 px-1 py-0.5 rounded border text-[10px] ${m.bg} ${m.border} ${m.text}`}
                                  >
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

          {/* Parse results — matches production review table */}
          {step === 'parse' && (
            <div className="flex flex-col flex-1 min-h-0 gap-3 overflow-hidden animate-[fadeIn_400ms_ease-out]">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-white font-semibold text-sm">
                    Review — {parsedCount} of {parsedCount} rows selected
                  </p>
                  <p className="text-slate-400 text-[10px] mt-0.5">Toggle ✓/✗ per row · edit any field inline</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <span className="px-3 py-1.5 bg-slate-700 text-white text-xs rounded-lg">← Lines</span>
                  <span className="px-3 py-1.5 bg-slate-700 text-white text-xs rounded-lg">Recalc durations</span>
                  <span
                    ref={importBtnRef}
                    className="px-4 py-1.5 bg-green-600 text-white font-semibold rounded-lg text-xs"
                  >
                    Import {parsedCount} items
                  </span>
                </div>
              </div>

              <div className="flex-1 min-h-0 border border-slate-700 rounded-xl bg-slate-900 overflow-auto">
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-700">
                    <tr>
                      <th className="px-2 py-1.5 w-8 border-r border-slate-600">
                        <span className="w-4 h-4 rounded border border-slate-400 bg-slate-600 flex items-center justify-center text-[10px] text-white mx-auto">
                          ✓
                        </span>
                      </th>
                      {['#', 'Start', 'Segment Name', 'Duration', 'Program Type', 'Speakers'].map((h) => (
                        <th
                          key={h}
                          className="px-2 py-1.5 text-left text-slate-300 text-[10px] font-semibold border-r border-slate-600 last:border-r-0"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DEMO_AGENDA_PARSED_ROWS.map((r, idx) => (
                      <tr key={idx} className="border-t border-slate-800 hover:bg-slate-800/30">
                        <td className="px-2 py-1 border-r border-slate-800 text-center">
                          <span className="w-4 h-4 rounded border border-green-600 bg-green-700/30 flex items-center justify-center text-[10px] text-green-300 mx-auto">
                            ✓
                          </span>
                        </td>
                        <td className="px-2 py-1 text-slate-500 border-r border-slate-800 text-[10px]">{r.row}</td>
                        <td className="px-2 py-1 border-r border-slate-800">
                          <input
                            readOnly
                            value={r.startTime ?? ''}
                            className="w-full px-1.5 py-0.5 bg-slate-800 text-white text-[10px] border border-slate-700 rounded"
                          />
                        </td>
                        <td className="px-2 py-1 border-r border-slate-800">
                          <input
                            readOnly
                            value={r.segmentName}
                            className="w-full px-1.5 py-0.5 bg-slate-800 text-white text-[10px] border border-slate-700 rounded"
                          />
                        </td>
                        <td className="px-2 py-1 border-r border-slate-800">
                          <input
                            readOnly
                            value={r.duration}
                            className="w-full px-1.5 py-0.5 bg-slate-800 text-white text-[10px] border border-slate-700 rounded font-mono"
                          />
                        </td>
                        <td className="px-2 py-1 border-r border-slate-800">
                          <select
                            disabled
                            value={r.programType || ''}
                            className="w-full px-1.5 py-0.5 text-white text-[10px] border border-slate-700 rounded"
                            style={
                              r.programType && PROGRAM_TYPE_COLORS[r.programType]
                                ? {
                                    backgroundColor: PROGRAM_TYPE_COLORS[r.programType],
                                    color: r.programType === 'Sub Cue' ? '#000' : '#fff',
                                  }
                                : { backgroundColor: '#1e293b' }
                            }
                          >
                            <option value="">—</option>
                            {PROGRAM_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-1">
                            <span className="text-slate-500 text-[10px]">
                              {r.speakerCount > 0 ? `${r.speakerCount}×` : '—'}
                            </span>
                            {r.speakerCount > 0 && (
                              <span className="text-blue-400 text-[10px] underline">Edit</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Visible label popup targets positioned near doc when labeling */}
      {labelPopup && step === 'preview' && (
        <div
          className="absolute z-40 bg-slate-900 border border-slate-600 rounded-xl shadow-2xl overflow-hidden"
          style={{
            left: Math.min(labelPopup.x + 8, 1020),
            top: Math.min(labelPopup.y + 10, 560),
            width: 232,
          }}
        >
          <div className="px-3 py-2 bg-slate-800 border-b border-slate-700">
            <p className="text-slate-400 text-[10px]">Label this as:</p>
            <p className="text-white text-[10px] font-mono mt-0.5 truncate">"{labelPopup.text}"</p>
          </div>
          {(['time', 'segment', 'person'] as const).map((lbl) => {
            const m = LABEL_META[lbl];
            return (
              <button
                key={lbl}
                type="button"
                ref={(el) => {
                  labelBtnRefs.current[lbl] = el;
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-slate-700 border-b border-slate-800 last:border-0 transition-colors"
              >
                <span className={`w-2 h-2 rounded-full ${m.dot} shrink-0`} />
                <span className="text-white font-medium">{m.emoji} {m.label}</span>
                <span className="ml-auto text-slate-500 text-[9px]">{m.desc}</span>
              </button>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
};
