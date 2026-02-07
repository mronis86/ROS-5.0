import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { socketClient } from '../services/socket-client';

const RESIZE_HANDLE_WIDTH = 6;
const MIN_COLUMN_FRACTION = 0.08; // each column at least ~8% of width
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

interface ScheduleItem {
  id: number;
  segmentName?: string;
  notes?: string;
  customFields?: Record<string, string>;
}

type ColumnSpec = { type: 'notes' | 'custom'; id: string; name: string };

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
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ colIndex: number; startX: number; startFrac: number; nextStartFrac: number } | null>(null);

  // Initialize equal fractions when the set of columns changes (not on every data update)
  const columnKeysStr = columns.map((c) => colKey(c)).join(',');
  useEffect(() => {
    if (columns.length === 0) return;
    const frac = 1 / columns.length;
    setColumnFractions((prev) => {
      const next: Record<string, number> = {};
      let sum = 0;
      columns.forEach((col) => {
        const k = colKey(col);
        next[k] = prev[k] ?? frac;
        sum += next[k];
      });
      if (sum > 0) {
        columns.forEach((col) => {
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
      return typeof f === 'number' && f > 0 ? f : 1 / Math.max(1, columns.length);
    },
    [columnFractions, columns.length]
  );

  const handleResizeStart = (colIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (!columns[colIndex] || !columns[colIndex + 1]) return;
    resizeRef.current = {
      colIndex,
      startX: e.clientX,
      startFrac: getColFraction(columns[colIndex]),
      nextStartFrac: getColFraction(columns[colIndex + 1]),
    };
  };

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r || !columns[r.colIndex] || !columns[r.colIndex + 1]) return;
      const el = gridContainerRef.current;
      if (!el) return;
      const contentWidth = el.offsetWidth - (columns.length - 1) * RESIZE_HANDLE_WIDTH;
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
      const leftKey = colKey(columns[r.colIndex]);
      const rightKey = colKey(columns[r.colIndex + 1]);
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
  }, [columns]);

  // 1 column = full width (1fr). 2+ columns = fractions that fill width; handle between each pair.
  const gridTemplateColumns =
    columns.length === 0
      ? '1fr'
      : columns.length === 1
        ? '1fr'
        : columns
            .map((col, j) =>
              j < columns.length - 1
                ? `${getColFraction(col)}fr ${RESIZE_HANDLE_WIDTH}px`
                : `${getColFraction(col)}fr`
            )
            .join(' ');

  return (
    <div className="min-h-screen min-w-0 w-full bg-slate-900 text-slate-100 p-4 sm:p-6 font-sans box-border">
      <div className="w-full max-w-[100vw] mx-auto min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-600">
          <h1 className="text-2xl font-bold text-white">
            {columns.length === 0
              ? 'Notes popout'
              : columns.length === 1
                ? columns[0].name
                : `${columns.map((c) => c.name).join(' • ')}`}
          </h1>
          <button
            type="button"
            onClick={() => setShowColumnPicker((v) => !v)}
            className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Change columns
          </button>
        </header>

        {showColumnPicker && (
          <div className="mb-6 p-4 bg-slate-800 rounded-xl border border-slate-600">
            <p className="text-slate-300 text-sm mb-3">Show these columns (one or more):</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {availableColumns.map((col) => (
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

        {columns.length > 0 && displayRows.length > 0 && (
          <div
            className="w-full overflow-auto rounded-xl border-2 border-slate-600 bg-slate-800"
            style={{ minHeight: 200 }}
          >
            <div
              ref={gridContainerRef}
              className="grid min-w-0 w-full"
              style={{
                gridTemplateColumns,
                gridTemplateRows: 'auto auto auto auto auto',
                width: '100%',
              }}
            >
              {/* Header row: column names */}
              {columns.map((col, j) => (
                <div
                  key={'h-' + colKey(col)}
                  style={{ gridColumn: 2 * j + 1, gridRow: 1 }}
                  className="px-3 py-2 bg-slate-700 border-b border-r border-slate-600 flex items-center"
                >
                  <h2 className="text-base font-bold text-white truncate">{col.name}</h2>
                </div>
              ))}
              {/* Resize handles: between columns (drag right = first column larger, left = second larger) */}
              {columns.map((_, j) =>
                j < columns.length - 1 ? (
                  <div
                    key={'resize-' + j}
                    style={{
                      gridColumn: 2 * j + 2,
                      gridRow: '1 / -1',
                    }}
                    className="bg-slate-700 border-r border-slate-600 cursor-col-resize hover:bg-blue-600 transition-colors flex items-stretch"
                    onMouseDown={(e) => handleResizeStart(j, e)}
                    title="Drag right to widen left column, left to widen right column"
                  >
                    <span className="w-full self-center h-12 flex items-center justify-center">
                      <span className="w-0.5 h-8 bg-slate-500 rounded" />
                    </span>
                  </div>
                ) : null
              )}
              {/* Data rows: 4 rows × N columns — each row gets same height from grid */}
              {displayRows.map((item, rowIndex) =>
                columns.map((col, colIndex) => {
                  const value = getCellValue(item, col);
                  const isCurrent = rowIndex === 0;
                  const label = isCurrent ? 'Current' : `Next ${rowIndex}`;
                  return (
                    <div
                      key={item.id + '-' + colKey(col)}
                      style={{ gridColumn: 2 * colIndex + 1, gridRow: rowIndex + 2 }}
                      className={`flex flex-col p-3 border-b border-r border-slate-600 overflow-hidden min-h-0 ${
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
          <p className="text-slate-500">No columns selected. Use “Change columns” to add some.</p>
        )}
      </div>
    </div>
  );
};

export default PinNotesPopoutPage;
