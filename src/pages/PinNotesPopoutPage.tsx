import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { socketClient } from '../services/socket-client';

const RESIZE_HANDLE_WIDTH = 6;
const MIN_COLUMN_FRACTION = 0.08; // each column at least ~8% of width
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

const ZOOM_STORAGE_KEY = 'pin-notes-popout-zoom';
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;

function getStoredZoom(): number {
  try {
    const v = parseFloat(localStorage.getItem(ZOOM_STORAGE_KEY) || '1');
    if (Number.isFinite(v) && v >= ZOOM_MIN && v <= ZOOM_MAX) return v;
  } catch {
    /* ignore */
  }
  return 1;
}

interface ScheduleItem {
  id: number;
  segmentName?: string;
  notes?: string;
  customFields?: Record<string, string>;
}

type ColumnSpec = { type: 'notes' | 'custom' | 'cue'; id: string; name: string };

interface PinNotesMessage {
  type: 'PIN_NOTES_UPDATE';
  eventId?: string | null;
  schedule: ScheduleItem[];
  activeItemId: number | null;
  columns: ColumnSpec[];
  availableColumns: ColumnSpec[];
}

function colKey(col: ColumnSpec): string {
  return col.type + '_' + col.id;
}

const CUE_COLUMN: ColumnSpec = { type: 'cue', id: 'cue', name: 'Cue' };

const PinNotesPopoutPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const eventIdFromUrl = searchParams.get('eventId') || '';

  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [lastLoadedCueId, setLastLoadedCueId] = useState<number | null>(null);
  const [columns, setColumns] = useState<ColumnSpec[]>([]);
  const [availableColumns, setAvailableColumns] = useState<ColumnSpec[]>([]);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [pickerSelected, setPickerSelected] = useState<ColumnSpec[]>([]);
  // Fraction of content width per column (0–1), sums to 1. Columns always fill page width.
  const [columnFractions, setColumnFractions] = useState<Record<string, number>>({});
  const [zoomLevel, setZoomLevel] = useState<number>(getStoredZoom);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ colIndex: number; startX: number; startFrac: number; nextStartFrac: number } | null>(null);

  const setZoom = useCallback((value: number) => {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(value / ZOOM_STEP) * ZOOM_STEP));
    setZoomLevel(clamped);
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  }, []);

  // Apply zoom via root font-size so all rem-based Tailwind (text, spacing, etc.) scales
  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = `${zoomLevel * 100}%`;
    return () => {
      root.style.fontSize = '';
    };
  }, [zoomLevel]);

  // Cue is always the first (left) column; user-selected columns follow
  const displayColumns = React.useMemo(
    () => [CUE_COLUMN, ...columns],
    [columns]
  );

  // Initialize fractions for non-Cue columns only (sum to 1) so they fill the remaining width
  const columnKeysStr = displayColumns.map((c) => colKey(c)).join(',');
  useEffect(() => {
    if (displayColumns.length === 0) return;
    const nonCue = displayColumns.filter((c) => c.type !== 'cue');
    if (nonCue.length === 0) return;
    const frac = 1 / nonCue.length;
    setColumnFractions((prev) => {
      const next: Record<string, number> = { ...prev };
      nonCue.forEach((col) => {
        next[colKey(col)] = prev[colKey(col)] ?? frac;
      });
      let sum = nonCue.reduce((s, col) => s + (next[colKey(col)] ?? 0), 0);
      if (sum > 0) {
        nonCue.forEach((col) => {
          next[colKey(col)] = (next[colKey(col)] ?? 0) / sum;
        });
      }
      return next;
    });
  }, [columnKeysStr]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as PinNotesMessage;
      if (data?.type === 'PIN_NOTES_UPDATE') {
        setSchedule(Array.isArray(data.schedule) ? data.schedule : []);
        setColumns(Array.isArray(data.columns) ? data.columns : []);
        setAvailableColumns(Array.isArray(data.availableColumns) ? data.availableColumns : []);
        if (!eventIdFromUrl && !eventIdRef.current) {
          setActiveItemId(data.activeItemId ?? null);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    if (window.opener) {
      window.opener.postMessage({ type: 'PIN_NOTES_READY' }, '*');
    }
    return () => window.removeEventListener('message', handleMessage);
  }, [eventIdFromUrl]);

  const eventIdRef = useRef<string>(eventIdFromUrl);
  useEffect(() => {
    eventIdRef.current = eventIdFromUrl;
  }, [eventIdFromUrl]);

  const eventId = eventIdFromUrl || undefined;
  const lastLoadedCueIdRef = useRef<number | null>(null);
  useEffect(() => {
    lastLoadedCueIdRef.current = lastLoadedCueId;
  }, [lastLoadedCueId]);

  // WebSocket for current cue (same as Photo View / Green Room)
  useEffect(() => {
    if (!eventId) return;

    const loadActiveTimer = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/active-timers/${eventId}`);
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data) ? data : data?.value;
        const active = Array.isArray(list) && list.length > 0 ? list[0] : data;
        if (active?.item_id) {
          const id = parseInt(active.item_id);
          setActiveItemId(id);
          setLastLoadedCueId(id);
        }
      } catch {
        // ignore
      }
    };

    loadActiveTimer();

    const callbacks = {
      onTimerUpdated: (data: any) => {
        if (data?.item_id) {
          const id = parseInt(data.item_id);
          setActiveItemId(id);
          setLastLoadedCueId(id);
        }
      },
      onTimerStarted: (data: any) => {
        if (data?.item_id) {
          const id = parseInt(data.item_id);
          setActiveItemId(id);
          setLastLoadedCueId(id);
        }
      },
      onActiveTimersUpdated: (data: any) => {
        if (data?.item_id && (data.timer_state === 'running' || data.timer_state === 'loaded')) {
          const id = parseInt(data.item_id);
          setActiveItemId(id);
          setLastLoadedCueId(id);
        }
      },
      onTimerStopped: () => {
        const last = lastLoadedCueIdRef.current;
        if (last != null) setActiveItemId(last);
      },
      onTimersStopped: () => {
        const last = lastLoadedCueIdRef.current;
        if (last != null) setActiveItemId(last);
        else setActiveItemId(null);
      },
      onInitialSync: async () => {
        await loadActiveTimer();
      },
    };

    socketClient.connect(eventId, callbacks);
    return () => socketClient.disconnect(eventId);
  }, [eventId]);

  // Sync picker when opening the panel
  useEffect(() => {
    if (showColumnPicker) setPickerSelected(columns);
  }, [showColumnPicker, columns]);

  const displayRows = React.useMemo(() => {
    if (schedule.length === 0) return [];
    const currentId = activeItemId;
    const idx =
      currentId != null
        ? schedule.findIndex((i) => i.id === currentId || i.id === Number(currentId))
        : -1;
    const start = idx >= 0 ? idx : 0;
    return [schedule[start], schedule[start + 1], schedule[start + 2], schedule[start + 3]].filter(
      Boolean
    ) as ScheduleItem[];
  }, [schedule, activeItemId]);

  const getCellValue = (item: ScheduleItem, col: ColumnSpec): string => {
    if (col.type === 'notes') return item.notes || '';
    if (col.type === 'cue') {
      const raw = (item.customFields?.cue ?? '').trim();
      return raw.replace(/^cue\s+/i, '') || '—';
    }
    return (item.customFields && item.customFields[col.name]) || '';
  };

  const isNotes = (col: ColumnSpec) => col.type === 'notes';

  const togglePickerColumn = (col: ColumnSpec) => {
    setPickerSelected((prev) => {
      const has = prev.some((c) => c.id === col.id && c.type === col.type);
      if (has) {
        const next = prev.filter((c) => !(c.id === col.id && c.type === col.type));
        return next.length > 0 ? next : prev;
      }
      return [...prev, col];
    });
  };

  const applyColumnPicker = () => {
    if (pickerSelected.length > 0 && window.opener) {
      window.opener.postMessage({ type: 'PIN_NOTES_SET_COLUMNS', columns: pickerSelected }, '*');
      setShowColumnPicker(false);
    }
  };

  const getColFraction = useCallback(
    (col: ColumnSpec) => {
      const f = columnFractions[colKey(col)];
      return typeof f === 'number' && f > 0 ? f : 1 / Math.max(1, displayColumns.length);
    },
    [columnFractions, displayColumns.length]
  );

  const handleResizeStart = (colIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (!displayColumns[colIndex] || !displayColumns[colIndex + 1]) return;
    resizeRef.current = {
      colIndex,
      startX: e.clientX,
      startFrac: getColFraction(displayColumns[colIndex]),
      nextStartFrac: getColFraction(displayColumns[colIndex + 1]),
    };
  };

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r || !displayColumns[r.colIndex] || !displayColumns[r.colIndex + 1]) return;
      const el = gridContainerRef.current;
      if (!el) return;
      const numHandles = displayColumns[0]?.type === 'cue' ? displayColumns.length - 2 : displayColumns.length - 1;
      const contentWidth = el.offsetWidth - Math.max(0, numHandles) * RESIZE_HANDLE_WIDTH;
      if (contentWidth <= 0) return;
      const deltaX = e.clientX - r.startX;
      const deltaFrac = deltaX / contentWidth;
      let leftFrac = r.startFrac + deltaFrac;
      let rightFrac = r.nextStartFrac - deltaFrac;
      const minF = MIN_COLUMN_FRACTION;
      if (leftFrac < minF) {
        rightFrac += leftFrac - minF;
        leftFrac = minF;
      }
      if (rightFrac < minF) {
        leftFrac += rightFrac - minF;
        rightFrac = minF;
      }
      const leftKey = colKey(displayColumns[r.colIndex]);
      const rightKey = colKey(displayColumns[r.colIndex + 1]);
      setColumnFractions((prev) => ({
        ...prev,
        [leftKey]: leftFrac,
        [rightKey]: rightFrac,
      }));
    };
    const handleUp = () => {
      resizeRef.current = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [displayColumns]);

  // Cue column is content-sized with no resize after it; other columns use fractions and have resize handles between them.
  const gridTemplateColumns =
    displayColumns.length === 0
      ? '1fr'
      : displayColumns.length === 1
        ? displayColumns[0].type === 'cue'
          ? 'minmax(4rem, max-content)'
          : '1fr'
        : (() => {
            const parts: string[] = [];
            parts.push(
              displayColumns[0].type === 'cue'
                ? 'minmax(4rem, max-content)'
                : `minmax(0, ${getColFraction(displayColumns[0])}fr)`
            );
            for (let j = 1; j < displayColumns.length; j++) {
              parts.push(`minmax(0, ${getColFraction(displayColumns[j])}fr)`);
              if (j < displayColumns.length - 1) parts.push(`${RESIZE_HANDLE_WIDTH}px`);
            }
            return parts.join(' ');
          })();

  // Grid positions: Cue has no handle after it, so col 0 at 1, col 1 at 2, handle at 3, col 2 at 4, ...
  const getGridColumn = (j: number) => (j === 0 ? 1 : 2 * j);
  const getHandleGridColumn = (j: number) => 2 * j + 1;

  return (
    <div className="min-h-screen min-w-0 w-full bg-slate-900 text-slate-100 font-sans box-border">
      <div className="min-w-0 w-full max-w-[100vw] mx-auto p-4 sm:p-6 box-border" style={{ width: '100%' }}>
        <header className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-600">
          <h1 className="text-2xl font-bold text-white min-w-0">
            {columns.length === 0
              ? 'Notes popout'
              : columns.length === 1
                ? columns[0].name
                : `${columns.map((c) => c.name).join(' • ')}`}
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-400 text-sm mr-1">Zoom:</span>
            <div className="flex items-center gap-0.5 bg-slate-700 rounded-lg p-0.5 border border-slate-600">
              <button
                type="button"
                onClick={() => setZoom(zoomLevel - ZOOM_STEP)}
                disabled={zoomLevel <= ZOOM_MIN}
                className="px-2.5 py-1 text-white hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors font-medium"
                title="Zoom out"
              >
                −
              </button>
              <span className="px-2.5 py-1 text-white text-sm font-medium min-w-[3rem] text-center tabular-nums">
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom(zoomLevel + ZOOM_STEP)}
                disabled={zoomLevel >= ZOOM_MAX}
                className="px-2.5 py-1 text-white hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors font-medium"
                title="Zoom in"
              >
                +
              </button>
            </div>
            {zoomLevel !== 1 && (
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="px-2 py-1 text-slate-400 hover:text-white text-sm rounded-md transition-colors"
                title="Reset to 100%"
              >
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowColumnPicker((v) => !v)}
              className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Change columns
            </button>
          </div>
        </header>

        {showColumnPicker && (
          <div className="mb-6 p-4 bg-slate-800 rounded-xl border border-slate-600">
            <p className="text-slate-300 text-sm mb-3">Show these columns (Cue is always shown on the left):</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {availableColumns.filter((col) => !(col.type === 'cue' && col.id === 'cue')).map((col) => (
                <label
                  key={col.type + col.id}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={pickerSelected.some((c) => c.id === col.id && c.type === col.type)}
                    onChange={() => togglePickerColumn(col)}
                    className="w-4 h-4 rounded border-slate-500"
                  />
                  <span className="text-white text-sm">{col.name}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowColumnPicker(false)}
                className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyColumnPicker}
                disabled={pickerSelected.length === 0}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg"
              >
                Apply
              </button>
            </div>
          </div>
        )}

        {displayRows.length === 0 && schedule.length > 0 && (
          <p className="text-slate-400">No rows in schedule for current day.</p>
        )}
        {displayRows.length === 0 && schedule.length === 0 && (
          <p className="text-slate-400">Open this window from Run of Show and select columns.</p>
        )}

        {displayRows.length > 0 && (
          <div
            className="w-full min-w-0 overflow-auto rounded-xl border-2 border-slate-600 bg-slate-800"
            style={{ minHeight: 200, width: '100%' }}
          >
            <div
              ref={gridContainerRef}
              className="grid min-w-0 w-full"
              style={{
                gridTemplateColumns,
                gridTemplateRows: 'auto auto auto auto auto',
                width: '100%',
                minWidth: 0,
                boxSizing: 'border-box',
              }}
            >
              {/* Header row: column names (no resize handle after Cue) */}
              {displayColumns.map((col, j) => (
                <div
                  key={'h-' + colKey(col)}
                  style={{ gridColumn: getGridColumn(j), gridRow: 1 }}
                  className="px-3 py-2 bg-slate-700 border-b border-r border-slate-600 flex items-center min-w-0"
                >
                  <h2 className="text-base font-bold text-white truncate">{col.name}</h2>
                </div>
              ))}
              {/* Resize handles: only between non-Cue columns (not after Cue) */}
              {displayColumns.map(
                (_, j) =>
                  j >= 1 &&
                  j < displayColumns.length - 1 && (
                    <div
                      key={'resize-' + j}
                      style={{ gridColumn: getHandleGridColumn(j), gridRow: '1 / -1' }}
                      className="bg-slate-700 border-r border-slate-600 cursor-col-resize hover:bg-blue-600 transition-colors flex items-stretch"
                      onMouseDown={(e) => handleResizeStart(j, e)}
                      title="Drag to resize columns"
                    >
                      <span className="w-full self-center h-12 flex items-center justify-center">
                        <span className="w-0.5 h-8 bg-slate-500 rounded" />
                      </span>
                    </div>
                  )
              )}
              {/* Data rows: 4 rows × N columns — each row gets same height from grid */}
              {displayRows.map((item, rowIndex) =>
                displayColumns.map((col, colIndex) => {
                  const value = getCellValue(item, col);
                  const isCurrent = rowIndex === 0;
                  const label = isCurrent ? 'Current' : `Next ${rowIndex}`;
                  if (col.type === 'cue') {
                    return (
                      <div
                        key={item.id + '-' + colKey(col)}
                        style={{ gridColumn: getGridColumn(colIndex), gridRow: rowIndex + 2 }}
                        className={`flex items-center p-3 border-b border-r border-slate-600 ${
                          isCurrent ? 'bg-slate-800/90 ring-inset ring-2 ring-amber-500' : 'bg-slate-800/50'
                        }`}
                      >
                        <span className={`font-semibold tabular-nums ${isCurrent ? 'text-amber-200' : 'text-slate-300'}`}>
                          CUE {value}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={item.id + '-' + colKey(col)}
                      style={{ gridColumn: getGridColumn(colIndex), gridRow: rowIndex + 2 }}
                      className={`flex flex-col p-3 border-b border-r border-slate-600 overflow-hidden min-h-0 min-w-0 ${
                        isCurrent ? 'bg-slate-800/90 ring-inset ring-2 ring-amber-500' : 'bg-slate-800/50'
                      }`}
                    >
                      <div className="flex flex-row items-stretch gap-0 flex-shrink-0 mb-6">
                        <span
                          className={`text-xs font-bold uppercase px-2 py-1.5 rounded-l flex-shrink-0 flex items-center ${
                            isCurrent ? 'bg-amber-600 text-white' : 'bg-slate-600 text-slate-300'
                          }`}
                        >
                          {label}
                        </span>
                        <h3
                          className={`flex-1 min-w-0 text-base font-semibold text-white leading-tight truncate pl-3 py-1.5 rounded-r flex items-center ${
                            isCurrent
                              ? 'border-l-2 border-amber-500 bg-amber-950/40'
                              : 'border-l-2 border-slate-500 bg-slate-700/50'
                          }`}
                          title={item.segmentName}
                        >
                          {item.segmentName || `Row ${item.id}`}
                        </h3>
                      </div>
                      <div className="text-left whitespace-pre-wrap break-words text-slate-200 text-sm flex-1 min-h-0 overflow-auto">
                        {isNotes(col) && value ? (
                          <div
                            className="notes-display prose prose-invert prose-sm max-w-none"
                            dangerouslySetInnerHTML={{ __html: value }}
                          />
                        ) : (
                          <span className={value ? '' : 'text-slate-500'}>{value || '—'}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {columns.length === 0 && displayRows.length > 0 && (
          <p className="text-slate-500">Only Cue column shown. Use “Change columns” to add Notes or other columns.</p>
        )}
      </div>
    </div>
  );
};

export default PinNotesPopoutPage;
