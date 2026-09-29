import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  applyCivicsBeeImportRows,
  CivicsBeeImportResult,
  CivicsBeeImportRow,
  CivicsBeeRoster,
} from '../../lib/civicsBee';

type ColumnRole = 'state' | 'firstName' | 'lastName' | '';

type CivicsBeeExcelImportModalProps = {
  isOpen: boolean;
  roster: CivicsBeeRoster;
  onClose: () => void;
  onApply: (result: CivicsBeeImportResult) => void;
};

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  return String(value).trim();
}

function guessRole(header: string): ColumnRole {
  const h = header.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!h) return '';
  if (/\b(state|territory|jurisdiction|region)\b/.test(h) || h === 'st') return 'state';
  if (/\b(first\s*name|firstname|given\s*name|fname|first)\b/.test(h)) return 'firstName';
  if (/\b(last\s*name|lastname|surname|family\s*name|lname|last)\b/.test(h)) return 'lastName';
  return '';
}

const ROLE_LABELS: Record<Exclude<ColumnRole, ''>, string> = {
  state: 'State / Territory',
  firstName: 'First name',
  lastName: 'Last name',
};

const CivicsBeeExcelImportModal: React.FC<CivicsBeeExcelImportModalProps> = ({
  isOpen,
  roster,
  onClose,
  onApply,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [columnMap, setColumnMap] = useState<Record<number, ColumnRole>>({});
  const [error, setError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<CivicsBeeImportResult | null>(null);

  const reset = () => {
    setFileName('');
    setSheetNames([]);
    setSelectedSheet('');
    setWorkbook(null);
    setHeaders([]);
    setRows([]);
    setColumnMap({});
    setError(null);
    setPreviewResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const loadSheet = (wb: XLSX.WorkBook, sheetName: string) => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) {
      setError('Could not read that sheet.');
      return;
    }
    const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });
    if (!matrix.length) {
      setHeaders([]);
      setRows([]);
      setColumnMap({});
      setError('Sheet is empty.');
      return;
    }

    const headerRow = (matrix[0] || []).map((c) => cellToString(c));
    const maxCols = Math.max(headerRow.length, ...matrix.slice(1).map((r) => (r || []).length), 0);
    const normalizedHeaders = Array.from({ length: maxCols }, (_, i) => {
      const label = headerRow[i] || '';
      return label || `Column ${i + 1}`;
    });
    const dataRows = matrix
      .slice(1)
      .map((r) => Array.from({ length: maxCols }, (_, i) => cellToString((r || [])[i])))
      .filter((r) => r.some((c) => c.length > 0));

    const guessed: Record<number, ColumnRole> = {};
    const used = new Set<ColumnRole>();
    normalizedHeaders.forEach((h, i) => {
      const role = guessRole(h);
      if (role && !used.has(role)) {
        guessed[i] = role;
        used.add(role);
      }
    });

    setHeaders(normalizedHeaders);
    setRows(dataRows);
    setColumnMap(guessed);
    setPreviewResult(null);
    setError(null);
  };

  const handleFile = async (file: File) => {
    setError(null);
    setPreviewResult(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const names = wb.SheetNames || [];
      if (!names.length) {
        setError('No sheets found in that file.');
        return;
      }
      setWorkbook(wb);
      setSheetNames(names);
      const first = names[0];
      setSelectedSheet(first);
      loadSheet(wb, first);
    } catch (e) {
      console.error(e);
      setError('Could not parse that Excel file.');
      setWorkbook(null);
      setSheetNames([]);
      setHeaders([]);
      setRows([]);
    }
  };

  const setRoleForColumn = (colIndex: number, role: ColumnRole) => {
    setColumnMap((prev) => {
      const next = { ...prev };
      if (!role) {
        delete next[colIndex];
        return next;
      }
      for (const [k, v] of Object.entries(next)) {
        if (v === role && Number(k) !== colIndex) delete next[Number(k)];
      }
      next[colIndex] = role;
      return next;
    });
    setPreviewResult(null);
  };

  const roleIndexes = useMemo(() => {
    let state = -1;
    let firstName = -1;
    let lastName = -1;
    for (const [k, v] of Object.entries(columnMap)) {
      const i = Number(k);
      if (v === 'state') state = i;
      if (v === 'firstName') firstName = i;
      if (v === 'lastName') lastName = i;
    }
    return { state, firstName, lastName };
  }, [columnMap]);

  const mappingReady =
    roleIndexes.state >= 0 && roleIndexes.firstName >= 0 && roleIndexes.lastName >= 0;

  const buildImportRows = (): CivicsBeeImportRow[] => {
    if (!mappingReady) return [];
    return rows.map((r) => ({
      stateRaw: r[roleIndexes.state] || '',
      firstName: r[roleIndexes.firstName] || '',
      lastName: r[roleIndexes.lastName] || '',
    }));
  };

  const runPreview = () => {
    if (!mappingReady) {
      setError('Map State, First name, and Last name columns first.');
      return;
    }
    const result = applyCivicsBeeImportRows(roster, buildImportRows());
    setPreviewResult(result);
    setError(null);
  };

  const applyImport = () => {
    if (!mappingReady) {
      setError('Map State, First name, and Last name columns first.');
      return;
    }
    const result = previewResult || applyCivicsBeeImportRows(roster, buildImportRows());
    onApply(result);
    reset();
    onClose();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  if (!isOpen) return null;

  const previewRows = rows.slice(0, 8).map((r) => ({
    state: mappingReady ? r[roleIndexes.state] || '' : '',
    first: mappingReady ? r[roleIndexes.firstName] || '' : '',
    last: mappingReady ? r[roleIndexes.lastName] || '' : '',
    merged:
      mappingReady
        ? [r[roleIndexes.firstName] || '', r[roleIndexes.lastName] || ''].filter(Boolean).join(' ')
        : '',
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-slate-600 bg-slate-900 shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Import students from Excel</h3>
            <p className="mt-1 text-sm text-slate-400">
              Choose which columns are State, First name, and Last name. Names are merged and matched
              to the roster; matched states are marked In game.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500"
            >
              Choose Excel file
            </button>
            {fileName && <span className="text-sm text-slate-300">{fileName}</span>}
            {sheetNames.length > 1 && (
              <label className="flex items-center gap-2 text-sm text-slate-300">
                Sheet
                <select
                  value={selectedSheet}
                  onChange={(e) => {
                    const name = e.target.value;
                    setSelectedSheet(name);
                    if (workbook) loadSheet(workbook, name);
                  }}
                  className="rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white"
                >
                  {sheetNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
              {error}
            </div>
          )}

          {headers.length > 0 && (
            <>
              <div>
                <h4 className="mb-2 text-sm font-semibold text-slate-200">Map columns</h4>
                <div className="overflow-hidden rounded-md border border-slate-700">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-300">
                      <tr>
                        <th className="px-3 py-2">Spreadsheet column</th>
                        <th className="px-3 py-2">Maps to</th>
                        <th className="px-3 py-2">Sample</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {headers.map((header, i) => (
                        <tr key={`${header}-${i}`}>
                          <td className="px-3 py-2 text-slate-100">{header}</td>
                          <td className="px-3 py-2">
                            <select
                              value={columnMap[i] || ''}
                              onChange={(e) => setRoleForColumn(i, e.target.value as ColumnRole)}
                              className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white"
                            >
                              <option value="">— ignore —</option>
                              {(Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>).map(
                                (role) => (
                                  <option key={role} value={role}>
                                    {ROLE_LABELS[role]}
                                  </option>
                                )
                              )}
                            </select>
                          </td>
                          <td className="max-w-[12rem] truncate px-3 py-2 text-slate-400">
                            {rows[0]?.[i] || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {rows.length} data row{rows.length === 1 ? '' : 's'} found
                  {mappingReady ? '' : ' · map all three required fields to continue'}
                </p>
              </div>

              {mappingReady && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-200">Preview (first rows)</h4>
                  <div className="overflow-hidden rounded-md border border-slate-700">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-300">
                        <tr>
                          <th className="px-3 py-2">State</th>
                          <th className="px-3 py-2">First</th>
                          <th className="px-3 py-2">Last</th>
                          <th className="px-3 py-2">Merged student</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {previewRows.map((r, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 text-slate-200">{r.state || '—'}</td>
                            <td className="px-3 py-2 text-slate-300">{r.first || '—'}</td>
                            <td className="px-3 py-2 text-slate-300">{r.last || '—'}</td>
                            <td className="px-3 py-2 font-medium text-white">{r.merged || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {previewResult && (
                <div className="rounded-md border border-slate-600 bg-slate-950/60 px-3 py-2 text-sm text-slate-200">
                  <p>
                    Will update <span className="font-semibold text-emerald-300">{previewResult.applied}</span>{' '}
                    state{previewResult.applied === 1 ? '' : 's'} (name + In game).
                  </p>
                  {previewResult.unmatched.length > 0 && (
                    <p className="mt-1 text-amber-200">
                      Unmatched state values ({previewResult.unmatched.length}):{' '}
                      {previewResult.unmatched.slice(0, 12).join(', ')}
                      {previewResult.unmatched.length > 12 ? '…' : ''}
                    </p>
                  )}
                  {previewResult.skippedEmpty > 0 && (
                    <p className="mt-1 text-slate-400">
                      Skipped {previewResult.skippedEmpty} empty/incomplete row
                      {previewResult.skippedEmpty === 1 ? '' : 's'}.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-700 px-5 py-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!mappingReady}
            onClick={runPreview}
            className="rounded-md border border-slate-500 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-40"
          >
            Preview match
          </button>
          <button
            type="button"
            disabled={!mappingReady}
            onClick={applyImport}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            Apply to roster
          </button>
        </div>
      </div>
    </div>
  );
};

export default CivicsBeeExcelImportModal;
