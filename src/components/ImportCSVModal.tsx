import React, { useState, useRef } from 'react';

interface ParsedRow {
  row: number;
  cue: string;
  segmentName: string;
  duration: string;
  shotType: string;
  hasPPT: boolean;
  hasQA: boolean;
  programType: string;
  notes: string;
  assets: string;
  speakers: string;
  timerId?: string;
  isPublic?: boolean;
  isIndented?: boolean;
  day?: number;
  customFields?: Record<string, string>;
}

interface ImportCSVModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (data: any[]) => void;
  onDeleteAll: () => void;
}

/** Parse a single CSV line respecting quoted fields */
const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (inQuotes) {
      current += c;
    } else if (c === ',' || c === '\t') {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
};

/** Normalize header for matching (lowercase, trim) */
const normalizeHeader = (h: string) => h.toLowerCase().trim().replace(/\s+/g, ' ');

const ImportCSVModal: React.FC<ImportCSVModalProps> = ({ isOpen, onClose, onImport, onDeleteAll }) => {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setParsedData([]);
    }
  };

  const parseYesNo = (val: string): boolean => {
    const v = String(val || '').trim().toLowerCase();
    return v === 'yes' || v === 'true' || v === '1';
  };

  const handleParse = async () => {
    if (!file) return;

    setIsProcessing(true);
    setError(null);

    try {
      const text = await file.text();
      // Handle BOM if present
      const content = text.replace(/^\uFEFF/, '');
      const lines = content.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '');

      if (lines.length < 2) {
        throw new Error('CSV must have at least a header row and one data row.');
      }

      const headerLine = lines[0];
      const headers = parseCSVLine(headerLine);
      const headerMap = new Map<string, number>();
      headers.forEach((h, i) => {
        const key = normalizeHeader(h);
        if (!headerMap.has(key)) headerMap.set(key, i);
      });

      const getCol = (row: string[], ...names: string[]): string => {
        for (const name of names) {
          const idx = headerMap.get(normalizeHeader(name));
          if (idx !== undefined && row[idx] !== undefined) return String(row[idx] ?? '').trim();
        }
        return '';
      };

      const parsedRows: ParsedRow[] = [];
      const customColumnNames = headers.filter(
        (h) =>
          !['row', 'cue', 'program type', 'shot type', 'segment name', 'duration', 'start time', 'end time', 'notes', 'assets', 'speakers', 'has ppt', 'has qa', 'timer id', 'is public', 'is indented', 'day'].includes(normalizeHeader(h))
      );

      for (let i = 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i]);
        const cue = getCol(row, 'CUE', 'cue');
        const programType = getCol(row, 'Program Type', 'program type');
        const shotType = getCol(row, 'Shot Type', 'shot type');
        const segmentName = getCol(row, 'Segment Name', 'segment name');
        const duration = getCol(row, 'Duration', 'duration');
        const notes = getCol(row, 'Notes', 'notes');
        const assets = getCol(row, 'Assets', 'assets');
        const speakers = getCol(row, 'Speakers', 'speakers');
        const hasPPTVal = getCol(row, 'Has PPT', 'has ppt');
        const hasQAVal = getCol(row, 'Has QA', 'has qa');
        const timerId = getCol(row, 'Timer ID', 'timer id');
        const isPublicVal = getCol(row, 'Is Public', 'is public');
        const isIndentedVal = getCol(row, 'Is Indented', 'is indented');
        const dayVal = getCol(row, 'Day', 'day');

        const customFields: Record<string, string> = {};
        customColumnNames.forEach((colName) => {
          const idx = headerMap.get(normalizeHeader(colName));
          if (idx !== undefined && row[idx] !== undefined) {
            customFields[colName] = String(row[idx] ?? '').trim();
          }
        });

        const parsedRow: ParsedRow = {
          row: i,
          cue: cue || `CUE ${i}`,
          segmentName: segmentName || `Imported Item ${i}`,
          programType,
          shotType,
          duration,
          notes,
          assets,
          speakers,
          hasPPT: parseYesNo(hasPPTVal),
          hasQA: parseYesNo(hasQAVal),
          timerId,
          isPublic: parseYesNo(isPublicVal),
          isIndented: parseYesNo(isIndentedVal),
          day: dayVal ? parseInt(dayVal, 10) || 1 : 1,
          customFields: Object.keys(customFields).length > 0 ? customFields : undefined
        };

        parsedRows.push(parsedRow);
      }

      setParsedData(parsedRows);
    } catch (err) {
      console.error('Error parsing CSV:', err);
      setError(err instanceof Error ? err.message : 'Failed to parse CSV');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImport = () => {
    if (parsedData.length === 0) return;
    // Map to format expected by handleExcelImport
    const mapped = parsedData.map((r) => ({
      cue: r.cue,
      segmentName: r.segmentName,
      programType: r.programType,
      shotType: r.shotType,
      duration: r.duration,
      notes: r.notes,
      assets: r.assets,
      speakers: r.speakers,
      hasPPT: r.hasPPT,
      hasQA: r.hasQA,
      timerId: r.timerId || '',
      isPublic: r.isPublic ?? false,
      isIndented: r.isIndented ?? false,
      day: r.day ?? 1,
      customFields: r.customFields || {}
    }));
    onImport(mapped);
    onClose();
  };

  const handleDeleteAll = () => {
    if (window.confirm('Are you sure you want to delete ALL existing schedule items? This action cannot be undone.')) {
      onDeleteAll();
    }
  };

  const handleClose = () => {
    setFile(null);
    setParsedData([]);
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
      <div className="bg-slate-800 rounded-lg w-full max-w-4xl max-h-[85vh] flex flex-col shadow-xl border border-slate-600">
        <header className="shrink-0 flex justify-between items-center p-6 pb-0">
          <h2 className="text-xl font-bold text-white">Import CSV File</h2>
          <button onClick={handleClose} className="text-slate-400 hover:text-white text-2xl leading-none">
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
          <div className="space-y-4">
            {parsedData.length === 0 && (
              <div className="bg-red-900/20 border border-red-600 rounded-md p-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-red-400 font-semibold mb-1">Clear Existing Data</h3>
                    <p className="text-slate-300 text-sm">Delete all existing schedule items before importing</p>
                  </div>
                  <button
                    onClick={handleDeleteAll}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-md transition-colors"
                  >
                    Delete All Rows
                  </button>
                </div>
              </div>
            )}

            <div className="bg-slate-700 p-4 rounded-md">
              <h3 className="text-white font-semibold mb-2">CSV Format</h3>
              <p className="text-slate-300 text-sm">
                Use a CSV exported from Run of Show, or one with headers: ROW, CUE, Program Type, Shot Type, Segment Name, Duration, Start Time, End Time, Notes, Assets, Speakers, Has PPT, Has QA, Timer ID, Is Public, Is Indented, Day, plus any custom columns.
              </p>
              <p className="text-slate-400 text-xs mt-2">Supports comma or tab delimiter. Shot Type: Podium, 1-Shot, 2-Shot … 7-Shot, Ted-Talk. Has PPT, Has QA, Is Public, Is Indented accept Yes/No.</p>
            </div>

            <div className="flex items-center gap-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors"
              >
                Choose CSV File
              </button>
              {file && (
                <span className="text-slate-300 text-sm truncate max-w-xs" title={file.name}>
                  {file.name}
                </span>
              )}
              <button
                onClick={handleParse}
                disabled={!file || isProcessing}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                {isProcessing ? 'Parsing...' : 'Parse CSV'}
              </button>
            </div>

            {error && (
              <div className="p-3 bg-red-900/50 border border-red-600 rounded text-red-200 text-sm">{error}</div>
            )}

            {parsedData.length > 0 && (
              <div>
                <h3 className="text-white font-semibold mb-2">
                  Preview: {parsedData.length} rows
                </h3>
                <div className="max-h-48 overflow-y-auto border border-slate-600 rounded bg-slate-900">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-700 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-slate-200">CUE</th>
                        <th className="px-3 py-2 text-slate-200">Segment Name</th>
                        <th className="px-3 py-2 text-slate-200">Duration</th>
                        <th className="px-3 py-2 text-slate-200">Day</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedData.slice(0, 20).map((row, i) => (
                        <tr key={i} className="border-t border-slate-600">
                          <td className="px-3 py-2 text-slate-200">{row.cue}</td>
                          <td className="px-3 py-2 text-slate-200 truncate max-w-[200px]" title={row.segmentName}>{row.segmentName}</td>
                          <td className="px-3 py-2 text-slate-200">{row.duration}</td>
                          <td className="px-3 py-2 text-slate-200">{row.day}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsedData.length > 20 && (
                    <p className="px-3 py-2 text-slate-400 text-xs">... and {parsedData.length - 20} more rows</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="shrink-0 p-6 pt-4 flex justify-end gap-3 border-t border-slate-600">
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={parsedData.length === 0}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            Import {parsedData.length > 0 ? parsedData.length : ''} Rows
          </button>
        </footer>
      </div>
    </div>
  );
};

export default ImportCSVModal;
