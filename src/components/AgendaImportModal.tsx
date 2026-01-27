import React, { useState, useRef, useCallback } from 'react';
import { getApiBaseUrl } from '../services/api-client';
import {
  parseAgenda,
  parseTimeToMinutes,
  minutesToHHMMSS,
  getLinesWithTimeIndices
} from '../lib/agenda-parser';

export interface AgendaParsedRow {
  row: number;
  cue: string;
  segmentName: string;
  startTime?: string;
  duration: string;
  shotType: string;
  hasPPT: boolean;
  hasQA: boolean;
  programType: string;
  notes: string;
  assets: string;
  speakers: string;
}

interface AgendaImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (data: AgendaParsedRow[]) => void;
  onDeleteAll: () => void;
}

type Step = 'select' | 'extract' | 'parse';

const PROGRAM_TYPES = [
  'PreShow/End', 'Podium Transition', 'Panel Transition', 'Full-Stage/Ted-Talk', 'Sub Cue',
  'No Transition', 'Video', 'Panel+Remote', 'Remote Only', 'Break F&B/B2B', 'Breakout Session', 'TBD', 'KILLED'
];

const PROGRAM_TYPE_COLORS: Record<string, string> = {
  'PreShow/End': '#8B5CF6',
  'Podium Transition': '#8B4513',
  'Panel Transition': '#404040',
  'Sub Cue': '#F3F4F6',
  'No Transition': '#059669',
  'Video': '#F59E0B',
  'Panel+Remote': '#1E40AF',
  'Remote Only': '#60A5FA',
  'Break F&B/B2B': '#EC4899',
  'Breakout Session': '#20B2AA',
  'TBD': '#6B7280',
  'KILLED': '#DC2626',
  'Full-Stage/Ted-Talk': '#EA580C'
};

type SpeakerLocation = 'Podium' | 'Seat' | 'Virtual' | 'Moderator';

interface SpeakerEdit {
  id: string;
  slot: number;
  location: SpeakerLocation;
  fullName: string;
  title: string;
  org: string;
  photoLink: string;
}

const AgendaImportModal: React.FC<AgendaImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  onDeleteAll,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [rawLines, setRawLines] = useState<string[]>([]);
  const [suggestedStartLine, setSuggestedStartLine] = useState<number>(1);
  const [startFromLine, setStartFromLine] = useState<string>('1');
  const [parsedData, setParsedData] = useState<AgendaParsedRow[]>([]);
  const [step, setStep] = useState<Step>('select');
  const [showRawText, setShowRawText] = useState(false);
  const [editingSpeakersRow, setEditingSpeakersRow] = useState<number | null>(null);
  const [showSpeakerModal, setShowSpeakerModal] = useState(false);
  const [tempSpeakers, setTempSpeakers] = useState<SpeakerEdit[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const lineListRef = useRef<HTMLDivElement>(null);

  const linesWithTimes = rawLines.length > 0 ? getLinesWithTimeIndices(rawLines) : [];

  const jumpToLine = useCallback((lineNum: number) => {
    setStartFromLine(String(lineNum));
    queueMicrotask(() => {
      const el = lineListRef.current?.querySelector(`[data-line="${lineNum}"]`);
      (el as HTMLElement)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, []);

  const reset = useCallback(() => {
    setFile(null);
    setRawLines([]);
    setSuggestedStartLine(1);
    setStartFromLine('1');
    setParsedData([]);
    setStep('select');
    setShowRawText(false);
    setEditingSpeakersRow(null);
    setShowSpeakerModal(false);
    setTempSpeakers([]);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setError(null);
      setRawLines([]);
      setParsedData([]);
      setStep('select');
    }
  };

  const handleExtract = async () => {
    if (!file) return;
    setIsExtracting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      // Always get fresh API base URL to ensure correct endpoint
      const apiBaseUrl = getApiBaseUrl();
      const url = `${apiBaseUrl}/api/parse-agenda?extractOnly=1`;
      console.log('[AgendaImportModal] API URL:', url, 'Hostname:', window.location.hostname);
      const res = await fetch(url, {
        method: 'POST',
        body: form
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const d = await res.json();
      let lines: string[] = Array.isArray(d.rawLines) ? d.rawLines : [];
      const text = typeof d.rawText === 'string' ? d.rawText : '';
      if (lines.length === 0 && text) {
        lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      }
      const suggested =
        typeof d.suggestedStartLineIndex === 'number'
          ? d.suggestedStartLineIndex + 1
          : typeof (d as { firstTimeLineIndex?: number }).firstTimeLineIndex === 'number'
            ? (d as { firstTimeLineIndex: number }).firstTimeLineIndex + 1
            : 1;
      const suggestedClamped = Math.max(1, Math.min(suggested, lines.length || 1));
      setRawLines(lines);
      setSuggestedStartLine(suggestedClamped);
      setStartFromLine(String(suggestedClamped));
      setStep('extract');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract text.');
      setRawLines([]);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleParse = useCallback(() => {
    if (rawLines.length === 0) return;
    const n = parseInt(startFromLine.trim(), 10);
    const start = !isNaN(n) && n >= 1 ? n : suggestedStartLine;
    const startIndex = Math.max(0, Math.min(start - 1, rawLines.length - 1));
    const slicedText = rawLines.slice(startIndex).join('\n');
    if (!slicedText.trim()) {
      setError('No content from the selected start line. Try a lower line number.');
      return;
    }
    setError(null);
    const { items } = parseAgenda(slicedText, 0);
    setParsedData(items as AgendaParsedRow[]);
    setStep('parse');
  }, [rawLines, startFromLine, suggestedStartLine]);

  const handleRecalculateDurations = () => {
    setParsedData((rows) => {
      const next = [...rows];
      for (let i = 0; i < next.length; i++) {
        const curr = parseTimeToMinutes(next[i].startTime ?? '');
        const nxt = i + 1 < next.length ? parseTimeToMinutes(next[i + 1].startTime ?? '') : null;
        if (curr != null && nxt != null && nxt > curr) {
          next[i] = { ...next[i], duration: minutesToHHMMSS(nxt - curr) };
        }
      }
      return next;
    });
    setError(null);
  };

  const updateRow = (
    index: number,
    field: keyof AgendaParsedRow,
    value: string | number | boolean
  ) => {
    setParsedData((prev) => {
      const next = [...prev];
      if (!next[index]) return next;
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const openSpeakerModal = (rowIndex: number) => {
    const row = parsedData[rowIndex];
    let list: SpeakerEdit[] = [];
    if (row?.speakers) {
      try {
        const raw = JSON.parse(row.speakers);
        const arr = Array.isArray(raw) ? raw : [raw];
        list = arr.map((s: any, i: number) => ({
          id: s.id ?? `speaker-${Date.now()}-${i}`,
          slot: typeof s.slot === 'number' ? s.slot : i + 1,
          location: ['Podium', 'Seat', 'Virtual', 'Moderator'].includes(s.location) ? s.location : 'Seat',
          fullName: String(s.fullName ?? '').trim(),
          title: String(s.title ?? '').trim(),
          org: String(s.org ?? '').trim(),
          photoLink: String(s.photoLink ?? s.photoUrl ?? '').trim()
        }));
      } catch {
        list = [];
      }
    }
    setTempSpeakers(list);
    setEditingSpeakersRow(rowIndex);
    setShowSpeakerModal(true);
  };

  const closeSpeakerModal = () => {
    setShowSpeakerModal(false);
    setEditingSpeakersRow(null);
    setTempSpeakers([]);
  };

  const addSpeaker = () => {
    if (tempSpeakers.length >= 7) return;
    const used = tempSpeakers.map((s) => s.slot);
    const nextSlot = [1, 2, 3, 4, 5, 6, 7].find((s) => !used.includes(s)) ?? 1;
    setTempSpeakers((prev) => [
      ...prev,
      {
        id: `speaker-${Date.now()}`,
        slot: nextSlot,
        location: 'Seat',
        fullName: '',
        title: '',
        org: '',
        photoLink: ''
      }
    ]);
  };

  const removeSpeaker = (id: string) => {
    setTempSpeakers((prev) => prev.filter((s) => s.id !== id));
  };

  const updateSpeaker = (id: string, field: keyof SpeakerEdit, value: string | number) => {
    setTempSpeakers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  const updateSpeakerSlot = (id: string, newSlot: number) => {
    setTempSpeakers((prev) => {
      const cur = prev.find((s) => s.id === id);
      if (!cur) return prev;
      const taken = prev.find((s) => s.id !== id && s.slot === newSlot);
      return prev.map((s) => {
        if (s.id === id) return { ...s, slot: newSlot };
        if (taken && s.id === taken.id) return { ...s, slot: cur.slot };
        return s;
      });
    });
  };

  const saveSpeakers = () => {
    if (editingSpeakersRow == null) return;
    const payload = tempSpeakers.map(({ id, slot, location, fullName, title, org, photoLink }) => ({
      id,
      slot,
      location,
      fullName,
      title,
      org,
      photoLink
    }));
    updateRow(editingSpeakersRow, 'speakers', JSON.stringify(payload));
    closeSpeakerModal();
  };

  const handleImport = () => {
    if (parsedData.length === 0) return;
    onImport(parsedData);
    onClose();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg p-6 w-full max-w-4xl max-h-[85vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-white">Import Agenda (PDF / Word)</h2>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/50">
              Beta
            </span>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white text-2xl"
            type="button"
          >
            ×
          </button>
        </div>
        <p className="text-amber-200/90 text-sm mb-4 -mt-2">
          Please check the import and refine items after importing (times, durations, speakers).
        </p>

        <div className="space-y-4">
          {parsedData.length === 0 && (
            <div className="bg-red-900/20 border border-red-600 rounded-md p-4 flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-red-400 font-semibold mb-1">Clear Existing Data</h3>
                <p className="text-gray-300 text-sm">Delete all schedule items before importing</p>
              </div>
              <button
                onClick={() =>
                  window.confirm('Delete ALL schedule items? This cannot be undone.') && onDeleteAll()
                }
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-md"
                type="button"
              >
                Delete All Rows
              </button>
            </div>
          )}

          {parsedData.length === 0 && step !== 'extract' && (
            <div className="bg-slate-700 p-4 rounded-md">
              <p className="text-gray-300 text-sm">
                <strong>1.</strong> Upload a PDF or Word (.docx) → <strong>Extract & view lines</strong>.
                <br />
                <strong>2.</strong> Set <strong>Start from line</strong>, then <strong>Parse</strong> to
                build event rows and times. Parsing starts at the line you set. First cue and durations
                are calculated from here. You can change the start line and re-parse anytime.
              </p>
            </div>
          )}

          {step === 'select' && (
            <div className="space-y-4">
              <div>
                <label className="block text-white text-sm font-medium mb-2">
                  Select file (.pdf, .docx)
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700"
                />
              </div>
              {file && (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-gray-300 text-sm">
                    <strong>{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)
                  </span>
                  <button
                    onClick={handleExtract}
                    disabled={isExtracting}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-md"
                    type="button"
                  >
                    {isExtracting ? 'Extracting…' : 'Extract & view lines'}
                  </button>
                  <button
                    onClick={handleClose}
                    className="px-5 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-md"
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 'extract' && rawLines.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">
                Choose start line — parse from here
              </h3>
              <p className="text-gray-400 text-sm">
                Parsing starts at line <strong>{startFromLine || '1'}</strong>. First cue and
                durations are calculated from here. Suggested: <strong>line {suggestedStartLine}</strong>.
                Change it below, click a line, or jump to a line with a time — then <strong>Parse</strong>.
              </p>
              {linesWithTimes.length > 0 && (
                <div className="space-y-2">
                  <span className="text-gray-400 text-sm font-medium">Jump to lines with times:</span>
                  <div className="flex flex-wrap gap-2">
                    {linesWithTimes.map(({ lineNumber, preview }) => (
                      <button
                        key={lineNumber}
                        type="button"
                        onClick={() => jumpToLine(lineNumber)}
                        className={`px-3 py-1.5 rounded-md text-sm font-mono transition-colors ${
                          parseInt(startFromLine, 10) === lineNumber
                            ? 'bg-amber-600 text-white ring-1 ring-amber-400'
                            : 'bg-slate-700 text-gray-300 hover:bg-slate-600 hover:text-white border border-slate-600'
                        }`}
                        title={`Line ${lineNumber}: ${preview}`}
                      >
                        <span className="text-amber-400/90">{lineNumber}</span>
                        <span className="mx-1.5 text-slate-500">·</span>
                        <span className="truncate max-w-[180px] inline-block align-bottom">
                          {preview}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-gray-400 text-sm">
                  Start from line (1–{rawLines.length}):
                </label>
                <input
                  type="number"
                  min={1}
                  max={rawLines.length}
                  value={startFromLine}
                  onChange={(e) => setStartFromLine(e.target.value)}
                  className="w-24 px-2 py-1.5 bg-slate-800 text-white text-sm border border-slate-600 rounded focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={handleParse}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-md"
                  type="button"
                >
                  Parse from this line
                </button>
                <button
                  onClick={reset}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded-md"
                  type="button"
                >
                  Choose another file
                </button>
              </div>
              <div
                ref={lineListRef}
                className="border border-slate-600 rounded-md bg-slate-900 overflow-auto max-h-96 min-h-32"
              >
                <div className="p-3 text-gray-300 text-xs font-mono space-y-0.5">
                  {rawLines.map((line, i) => {
                    const lineNum = i + 1;
                    const isSelected =
                      parseInt(startFromLine, 10) === lineNum || startFromLine === String(lineNum);
                    const hasTime = linesWithTimes.some((t) => t.lineNumber === lineNum);
                    return (
                      <div
                        key={i}
                        data-line={lineNum}
                        role="button"
                        tabIndex={0}
                        onClick={() => setStartFromLine(String(lineNum))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') setStartFromLine(String(lineNum));
                        }}
                        className={`leading-relaxed cursor-pointer py-0.5 px-1 rounded hover:bg-slate-700/70 ${
                          isSelected ? 'bg-amber-600/30 text-amber-100' : ''
                        } ${hasTime ? 'border-l-2 border-l-amber-500/50 pl-1' : ''}`}
                      >
                        <span className="text-gray-500 select-none inline-block w-10 tabular-nums">
                          {lineNum}
                        </span>{' '}
                        {line || ' '}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 'extract' && rawLines.length === 0 && (
            <div className="bg-amber-900/30 border border-amber-600 rounded-md p-4">
              <p className="text-amber-200 mb-3">
                No lines extracted. Try another file or check the format.
              </p>
              <button
                onClick={reset}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-md"
                type="button"
              >
                Choose another file
              </button>
            </div>
          )}

          {error && (
            <div className="bg-red-600 text-white p-3 rounded-md">
              <strong>Error:</strong> {error}
            </div>
          )}

          {step === 'parse' && parsedData.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-white">
                Preview — {parsedData.length} items
              </h3>
              <div className="border border-slate-600 rounded-md bg-slate-700 max-h-96 overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-slate-600">
                    <tr>
                      <th className="px-2 py-2 text-left text-white text-sm border-r border-slate-500 w-12">
                        Row
                      </th>
                      <th className="px-2 py-2 text-left text-white text-sm border-r border-slate-500 w-16">
                        CUE
                      </th>
                      <th className="px-2 py-2 text-left text-white text-sm border-r border-slate-500 w-20">
                        Start
                      </th>
                      <th className="px-2 py-2 text-left text-white text-sm border-r border-slate-500">
                        Segment
                      </th>
                      <th className="px-2 py-2 text-left text-white text-sm border-r border-slate-500 w-24">
                        Duration
                      </th>
                      <th className="px-2 py-2 text-left text-white text-sm border-r border-slate-500 w-36">
                        Program type
                      </th>
                      <th className="px-2 py-2 text-left text-white text-sm w-32">Speakers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.map((r, idx) => (
                      <tr key={idx} className="border-t border-slate-600 hover:bg-slate-600">
                        <td className="px-2 py-1 text-white text-sm border-r border-slate-500">
                          {r.row}
                        </td>
                        <td className="px-2 py-1 text-white text-sm border-r border-slate-500">
                          {r.cue}
                        </td>
                        <td className="px-2 py-1 border-r border-slate-500">
                          <input
                            value={r.startTime ?? ''}
                            onChange={(e) => updateRow(idx, 'startTime', e.target.value)}
                            placeholder="9:00 AM"
                            className="w-full px-2 py-1 bg-slate-800 text-white text-sm border border-slate-600 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-2 py-1 border-r border-slate-500">
                          <input
                            value={r.segmentName}
                            onChange={(e) => updateRow(idx, 'segmentName', e.target.value)}
                            className="w-full px-2 py-1 bg-slate-800 text-white text-sm border border-slate-600 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-2 py-1 border-r border-slate-500">
                          <input
                            value={r.duration}
                            onChange={(e) => updateRow(idx, 'duration', e.target.value)}
                            placeholder="HH:MM:SS"
                            className="w-full px-2 py-1 bg-slate-800 text-white text-sm border border-slate-600 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                        <td className="px-2 py-1 border-r border-slate-500">
                          <select
                            value={r.programType || ''}
                            onChange={(e) => updateRow(idx, 'programType', e.target.value)}
                            className="w-full px-2 py-1 bg-slate-800 text-white text-sm border border-slate-600 rounded focus:ring-1 focus:ring-blue-500"
                            style={
                              r.programType && PROGRAM_TYPE_COLORS[r.programType]
                                ? {
                                    backgroundColor: PROGRAM_TYPE_COLORS[r.programType],
                                    color: r.programType === 'Sub Cue' ? '#000' : '#fff'
                                  }
                                : undefined
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
                          <div className="flex items-center gap-2">
                            {r.speakers ? (
                              (() => {
                                try {
                                  const arr = JSON.parse(r.speakers);
                                  const n = Array.isArray(arr) ? arr.length : 0;
                                  return (
                                    <span className="text-gray-300 text-sm">
                                      {n} speaker{n !== 1 ? 's' : ''}
                                    </span>
                                  );
                                } catch {
                                  return <span className="text-gray-400 text-sm">—</span>;
                                }
                              })()
                            ) : (
                              <span className="text-gray-500 text-sm">—</span>
                            )}
                            <button
                              type="button"
                              onClick={() => openSpeakerModal(idx)}
                              className="text-blue-400 hover:text-blue-300 text-xs font-medium"
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowRawText((s) => !s)}
                  className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                >
                  {showRawText ? 'Hide' : 'Show'} raw lines
                </button>
                {showRawText && rawLines.length > 0 && (
                  <>
                    <label className="text-gray-400 text-sm">
                      Start from line (1–{rawLines.length}):
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={rawLines.length}
                      value={startFromLine}
                      onChange={(e) => setStartFromLine(e.target.value)}
                      className="w-20 px-2 py-1 bg-slate-800 text-white text-sm border border-slate-600 rounded"
                    />
                    <button
                      type="button"
                      onClick={handleParse}
                      className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-sm rounded"
                    >
                      Re-parse from this line
                    </button>
                  </>
                )}
              </div>
              {showRawText && rawLines.length > 0 && linesWithTimes.length > 0 && (
                <div className="space-y-2">
                  <span className="text-gray-400 text-sm font-medium">Jump to lines with times:</span>
                  <div className="flex flex-wrap gap-2">
                    {linesWithTimes.map(({ lineNumber, preview }) => (
                      <button
                        key={lineNumber}
                        type="button"
                        onClick={() => jumpToLine(lineNumber)}
                        className={`px-3 py-1.5 rounded-md text-sm font-mono transition-colors ${
                          parseInt(startFromLine, 10) === lineNumber
                            ? 'bg-amber-600 text-white ring-1 ring-amber-400'
                            : 'bg-slate-700 text-gray-300 hover:bg-slate-600 hover:text-white border border-slate-600'
                        }`}
                        title={`Line ${lineNumber}: ${preview}`}
                      >
                        <span className="text-amber-400/90">{lineNumber}</span>
                        <span className="mx-1.5 text-slate-500">·</span>
                        <span className="truncate max-w-[180px] inline-block align-bottom">
                          {preview}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {showRawText && rawLines.length > 0 && (
                <div
                  ref={lineListRef}
                  className="border border-slate-600 rounded-md bg-slate-900 overflow-auto max-h-48"
                >
                  <div className="p-3 text-gray-300 text-xs font-mono space-y-0.5">
                    {rawLines.map((line, i) => {
                      const lineNum = i + 1;
                      const hasTime = linesWithTimes.some((t) => t.lineNumber === lineNum);
                      const isSelected =
                        parseInt(startFromLine, 10) === lineNum || startFromLine === String(lineNum);
                      return (
                        <div
                          key={i}
                          data-line={lineNum}
                          role="button"
                          tabIndex={0}
                          onClick={() => setStartFromLine(String(lineNum))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setStartFromLine(String(lineNum));
                          }}
                          className={`cursor-pointer hover:bg-slate-700/70 py-0.5 px-1 rounded ${
                            isSelected ? 'bg-amber-600/30 text-amber-100' : ''
                          } ${hasTime ? 'border-l-2 border-l-amber-500/50 pl-1' : ''}`}
                        >
                          <span className="text-gray-500 select-none inline-block w-8">
                            {lineNum}
                          </span>{' '}
                          {line || ' '}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap justify-center gap-3 pt-2">
                <button
                  onClick={handleRecalculateDurations}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium rounded-md"
                  type="button"
                >
                  Recalculate durations from start times
                </button>
                <button
                  onClick={handleImport}
                  className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md"
                  type="button"
                >
                  Import {parsedData.length} items
                </button>
                <button
                  onClick={reset}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md"
                  type="button"
                >
                  Import another file
                </button>
              </div>
            </div>
          )}

          {step === 'parse' && parsedData.length === 0 && rawLines.length > 0 && (
            <div className="bg-amber-900/30 border border-amber-600 rounded-md p-4">
              <p className="text-amber-200 mb-3">
                No items parsed. Try a different start line or check the format.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => setStep('extract')}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-md"
                  type="button"
                >
                  Back to start-line view
                </button>
                <button
                  onClick={reset}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-md"
                  type="button"
                >
                  Choose another file
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showSpeakerModal && editingSpeakersRow !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
          <div className="bg-slate-800 rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-xl">
            <div className="flex justify-between items-center p-4 border-b border-slate-700">
              <h3 className="text-lg font-bold text-white">
                Edit speakers — {parsedData[editingSpeakersRow]?.segmentName || 'Item'}
              </h3>
              <button
                type="button"
                onClick={closeSpeakerModal}
                className="text-slate-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              <button
                type="button"
                onClick={addSpeaker}
                disabled={tempSpeakers.length >= 7}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg"
              >
                + Add speaker {tempSpeakers.length < 7 && `(${7 - tempSpeakers.length} left)`}
              </button>
              {tempSpeakers.length === 0 && (
                <p className="text-slate-400 text-sm">No speakers. Click &quot;Add speaker&quot; to add one.</p>
              )}
              {[...tempSpeakers].sort((a, b) => a.slot - b.slot).map((s) => (
                <div key={s.id} className="bg-slate-700 rounded-lg p-4 border border-slate-600 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-white font-medium">Speaker {s.slot}</span>
                    <button
                      type="button"
                      onClick={() => removeSpeaker(s.id)}
                      className="w-8 h-8 bg-red-600 hover:bg-red-500 text-white rounded flex items-center justify-center text-sm"
                    >
                      ×
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Slot</label>
                      <select
                        value={s.slot}
                        onChange={(e) => updateSpeakerSlot(s.id, parseInt(e.target.value, 10))}
                        className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm"
                      >
                        {[1, 2, 3, 4, 5, 6, 7].map((slot) => {
                          const used = tempSpeakers.some((x) => x.id !== s.id && x.slot === slot);
                          return (
                            <option key={slot} value={slot} className={used ? 'bg-amber-900' : ''}>
                              {slot}{used ? ' (used)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Location</label>
                      <select
                        value={s.location}
                        onChange={(e) => updateSpeaker(s.id, 'location', e.target.value as SpeakerLocation)}
                        className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm"
                      >
                        <option value="Podium">Podium</option>
                        <option value="Seat">Seat</option>
                        <option value="Moderator">Moderator</option>
                        <option value="Virtual">Virtual</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-1">
                      <label className="block text-slate-400 text-xs mb-1">Full name</label>
                      <input
                        value={s.fullName}
                        onChange={(e) => updateSpeaker(s.id, 'fullName', e.target.value)}
                        placeholder="Full name"
                        className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Title</label>
                      <input
                        value={s.title}
                        onChange={(e) => updateSpeaker(s.id, 'title', e.target.value)}
                        placeholder="Title"
                        className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Organization</label>
                      <input
                        value={s.org}
                        onChange={(e) => updateSpeaker(s.id, 'org', e.target.value)}
                        placeholder="Org"
                        className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-500"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-slate-400 text-xs mb-1">Photo URL</label>
                      <div className="flex gap-2 items-center">
                        <input
                          type="url"
                          value={s.photoLink}
                          onChange={(e) => updateSpeaker(s.id, 'photoLink', e.target.value)}
                          placeholder="https://…"
                          className="flex-1 px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-500"
                        />
                        {s.photoLink && (
                          <img
                            src={s.photoLink}
                            alt=""
                            className="w-10 h-10 rounded object-cover border border-slate-500"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-700 p-4 flex gap-3">
              <button
                type="button"
                onClick={saveSpeakers}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg"
              >
                Save & close
              </button>
              <button
                type="button"
                onClick={closeSpeakerModal}
                className="flex-1 px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white font-medium rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgendaImportModal;
