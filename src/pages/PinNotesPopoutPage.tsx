import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { socketClient } from '../services/socket-client';
import { apiClient, getApiBaseUrl, type UserEventNoteOperator } from '../services/api-client';
import {
  getStoredOperatorName,
  operatorUserId,
  storeOperatorName,
} from '../lib/pinNotesOperator';

const RESIZE_HANDLE_WIDTH = 6;
const MIN_COLUMN_FRACTION = 0.08;
const API_BASE = getApiBaseUrl();

const ZOOM_STORAGE_KEY = 'pin-notes-popout-zoom';
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;
const SAVE_DEBOUNCE_MS = 600;

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

type RosColumnSpec = { type: 'notes' | 'custom' | 'cue'; id: string; name: string };
type MyNotesColumnSpec = { type: 'my-notes'; id: 'my-notes'; name: string };
type OperatorNotesColumnSpec = { type: 'operator-notes'; id: string; name: string; userId: string };
type DisplayColumn = RosColumnSpec | MyNotesColumnSpec | OperatorNotesColumnSpec;

interface PinNotesMessage {
  type: 'PIN_NOTES_UPDATE';
  eventId?: string | null;
  schedule: ScheduleItem[];
  activeItemId: number | null;
  columns: RosColumnSpec[];
  availableColumns: RosColumnSpec[];
}

function colKey(col: DisplayColumn): string {
  return col.type + '_' + col.id;
}

function personalNoteKey(itemId: number): string {
  return `${itemId}:personal`;
}

const CUE_COLUMN: RosColumnSpec = { type: 'cue', id: 'cue', name: 'Cue' };

const PinNotesPopoutPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const eventIdFromUrl = searchParams.get('eventId') || '';

  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [lastLoadedCueId, setLastLoadedCueId] = useState<number | null>(null);
  const [columns, setColumns] = useState<RosColumnSpec[]>([]);
  const [availableColumns, setAvailableColumns] = useState<RosColumnSpec[]>([]);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [pickerSelected, setPickerSelected] = useState<RosColumnSpec[]>([]);
  const [pickerSelectedOperators, setPickerSelectedOperators] = useState<OperatorNotesColumnSpec[]>([]);
  const [operatorColumns, setOperatorColumns] = useState<OperatorNotesColumnSpec[]>([]);
  const [savedOperators, setSavedOperators] = useState<UserEventNoteOperator[]>([]);
  const [operatorsLoadError, setOperatorsLoadError] = useState<string | null>(null);
  const [operatorNotesByUser, setOperatorNotesByUser] = useState<Record<string, Record<string, string>>>({});
  const [personalNotes, setPersonalNotes] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [operatorName, setOperatorName] = useState<string | null>(() => getStoredOperatorName());
  const [myNotesEnabled, setMyNotesEnabled] = useState(() => !!getStoredOperatorName());
  const [showNameModal, setShowNameModal] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [columnFractions, setColumnFractions] = useState<Record<string, number>>({});
  const [zoomLevel, setZoomLevel] = useState<number>(getStoredZoom);

  const eventIdRef = useRef<string>(eventIdFromUrl);
  const operatorUserIdRef = useRef<string | null>(
    operatorName ? operatorUserId(operatorName) : null
  );
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingSavesRef = useRef<Set<string>>(new Set());
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ colIndex: number; startX: number; startFrac: number; nextStartFrac: number } | null>(null);
  const lastLoadedCueIdRef = useRef<number | null>(null);

  const eventId = eventIdFromUrl || undefined;

  useEffect(() => {
    eventIdRef.current = eventIdFromUrl;
  }, [eventIdFromUrl]);

  useEffect(() => {
    lastLoadedCueIdRef.current = lastLoadedCueId;
  }, [lastLoadedCueId]);

  const myNotesColumn: MyNotesColumnSpec | null = React.useMemo(() => {
    if (!myNotesEnabled || !operatorName) return null;
    return { type: 'my-notes', id: 'my-notes', name: `My notes (${operatorName})` };
  }, [myNotesEnabled, operatorName]);

  const currentOpId = operatorName ? operatorUserId(operatorName) : null;

  const displayColumns = React.useMemo((): DisplayColumn[] => {
    const ros = columns.filter((c) => c.type !== 'cue');
    const opCols = operatorColumns.filter(
      (col) => !(myNotesColumn && col.userId === currentOpId)
    );
    return myNotesColumn
      ? [CUE_COLUMN, ...ros, ...opCols, myNotesColumn]
      : [CUE_COLUMN, ...ros, ...opCols];
  }, [columns, myNotesColumn, operatorColumns, currentOpId]);

  const operatorDisplayName = (op: UserEventNoteOperator) =>
    op.user_name?.trim() || op.user_id.replace(/^operator:/, '').replace(/-/g, ' ');

  const notesRowsToMap = (rows: { schedule_item_id: number; column_key: string; content: string }[]) => {
    const map: Record<string, string> = {};
    for (const row of rows || []) {
      map[`${row.schedule_item_id}:${row.column_key}`] = row.content || '';
    }
    return map;
  };

  const loadPersonalNotes = useCallback(async (evId: string, opUserId: string) => {
    try {
      const data = await apiClient.getUserEventNotes(evId, opUserId);
      setPersonalNotes(notesRowsToMap(data.notes || []));
    } catch {
      /* API/table may not be deployed yet */
    }
  }, []);

  const loadOperatorNotes = useCallback(async (evId: string, opUserId: string) => {
    try {
      const data = await apiClient.getUserEventNotes(evId, opUserId);
      setOperatorNotesByUser((prev) => ({
        ...prev,
        [opUserId]: notesRowsToMap(data.notes || []),
      }));
    } catch {
      /* ignore */
    }
  }, []);

  const refreshSavedOperators = useCallback(async (evId: string) => {
    try {
      const data = await apiClient.listUserEventNoteOperators(evId);
      setSavedOperators(data.operators || []);
      setOperatorsLoadError(null);
    } catch (error) {
      setSavedOperators([]);
      const message = error instanceof Error ? error.message : '';
      if (message.includes('404')) {
        setOperatorsLoadError(
          'The Railway API has not been redeployed yet with the operator-notes list endpoint. Redeploy api-server.js on Railway, then refresh this page.'
        );
      } else {
        setOperatorsLoadError(
          'Could not reach the API to load saved operator names. Your own notes can still save if the API is running.'
        );
      }
    }
  }, []);

  const activateOperator = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      storeOperatorName(trimmed);
      const opId = operatorUserId(trimmed);
      operatorUserIdRef.current = opId;
      setOperatorName(trimmed);
      setMyNotesEnabled(true);
      setShowNameModal(false);
      setNameDraft('');
      const evId = eventIdRef.current;
      if (evId) loadPersonalNotes(evId, opId);
    },
    [loadPersonalNotes]
  );

  useEffect(() => {
    if (operatorName) {
      operatorUserIdRef.current = operatorUserId(operatorName);
      const evId = eventIdFromUrl;
      if (evId && myNotesEnabled) {
        loadPersonalNotes(evId, operatorUserId(operatorName));
      }
    }
  }, [eventIdFromUrl, operatorName, myNotesEnabled, loadPersonalNotes]);

  useEffect(() => {
    if (!eventIdFromUrl) return;
    refreshSavedOperators(eventIdFromUrl);
  }, [eventIdFromUrl, refreshSavedOperators]);

  useEffect(() => {
    if (!eventIdFromUrl) return;
    for (const col of operatorColumns) {
      if (!operatorNotesByUser[col.userId]) {
        loadOperatorNotes(eventIdFromUrl, col.userId);
      }
    }
  }, [eventIdFromUrl, operatorColumns, operatorNotesByUser, loadOperatorNotes]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as PinNotesMessage;
      if (data?.type !== 'PIN_NOTES_UPDATE') return;
      setSchedule(Array.isArray(data.schedule) ? data.schedule : []);
      setColumns(Array.isArray(data.columns) ? data.columns : []);
      setAvailableColumns(Array.isArray(data.availableColumns) ? data.availableColumns : []);
      if (data.eventId) eventIdRef.current = data.eventId;
      if (data.eventId && operatorUserIdRef.current && myNotesEnabled) {
        loadPersonalNotes(data.eventId, operatorUserIdRef.current);
      }
      if (!eventIdFromUrl && !eventIdRef.current) {
        setActiveItemId(data.activeItemId ?? null);
      }
    };

    window.addEventListener('message', handleMessage);
    if (window.opener) {
      window.opener.postMessage({ type: 'PIN_NOTES_READY' }, '*');
    }
    return () => window.removeEventListener('message', handleMessage);
  }, [eventIdFromUrl, loadPersonalNotes, myNotesEnabled]);

  const setZoom = useCallback((value: number) => {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(value / ZOOM_STEP) * ZOOM_STEP));
    setZoomLevel(clamped);
    try {
      localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = `${zoomLevel * 100}%`;
    return () => {
      root.style.fontSize = '';
    };
  }, [zoomLevel]);

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
        /* ignore */
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

  useEffect(() => {
    if (!showColumnPicker) return;
    setPickerSelected(columns);
    setPickerSelectedOperators(operatorColumns);
    const evId = eventIdRef.current;
    if (evId) refreshSavedOperators(evId);
  }, [showColumnPicker, columns, operatorColumns, refreshSavedOperators]);

  useEffect(() => {
    if (!showNameModal) return;
    const evId = eventIdRef.current;
    if (evId) refreshSavedOperators(evId);
  }, [showNameModal, refreshSavedOperators]);

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

  const getSharedCellValue = (item: ScheduleItem, col: RosColumnSpec): string => {
    if (col.type === 'notes') return item.notes || '';
    if (col.type === 'cue') {
      const raw = (item.customFields?.cue ?? '').trim();
      return raw.replace(/^cue\s+/i, '') || '—';
    }
    return (
      (item.customFields && item.customFields[col.id]) ||
      (item.customFields && item.customFields[col.name]) ||
      ''
    );
  };

  const flushSave = useCallback(
    async (itemId: number, content: string) => {
      const evId = eventIdRef.current;
      const opId = operatorUserIdRef.current;
      if (!evId || !opId || !operatorName) return;
      const key = personalNoteKey(itemId);
      pendingSavesRef.current.add(key);
      setSaveStatus('saving');
      try {
        await apiClient.saveUserEventNote({
          event_id: evId,
          user_id: opId,
          user_name: operatorName,
          schedule_item_id: itemId,
          column_key: 'personal',
          content,
        });
        pendingSavesRef.current.delete(key);
        setSaveStatus(pendingSavesRef.current.size > 0 ? 'saving' : 'saved');
        if (pendingSavesRef.current.size === 0) {
          setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 2000);
          refreshSavedOperators(evId);
        }
      } catch {
        pendingSavesRef.current.delete(key);
        setSaveStatus('error');
      }
    },
    [operatorName, refreshSavedOperators]
  );

  const handlePersonalNoteChange = useCallback(
    (itemId: number, value: string) => {
      const key = personalNoteKey(itemId);
      setPersonalNotes((prev) => ({ ...prev, [key]: value }));
      if (saveTimersRef.current[key]) clearTimeout(saveTimersRef.current[key]);
      saveTimersRef.current[key] = setTimeout(() => {
        flushSave(itemId, value);
        delete saveTimersRef.current[key];
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave]
  );

  useEffect(() => {
    return () => {
      Object.values(saveTimersRef.current).forEach(clearTimeout);
    };
  }, []);

  const openNameModal = () => {
    setNameDraft(operatorName || '');
    setShowNameModal(true);
  };

  const togglePickerColumn = (col: RosColumnSpec) => {
    setPickerSelected((prev) => {
      const has = prev.some((c) => c.id === col.id && c.type === col.type);
      if (has) {
        const next = prev.filter((c) => !(c.id === col.id && c.type === col.type));
        return next.length > 0 ? next : prev;
      }
      return [...prev, col];
    });
  };

  const operatorColumnFromSaved = (op: UserEventNoteOperator): OperatorNotesColumnSpec => {
    const label = operatorDisplayName(op);
    return {
      type: 'operator-notes',
      id: op.user_id,
      userId: op.user_id,
      name: `${label}'s notes`,
    };
  };

  const togglePickerOperator = (op: UserEventNoteOperator) => {
    const col = operatorColumnFromSaved(op);
    setPickerSelectedOperators((prev) => {
      const has = prev.some((c) => c.userId === col.userId);
      if (has) return prev.filter((c) => c.userId !== col.userId);
      return [...prev, col];
    });
  };

  const applyColumnPicker = () => {
    if (pickerSelected.length === 0) return;
    if (window.opener) {
      window.opener.postMessage({ type: 'PIN_NOTES_SET_COLUMNS', columns: pickerSelected }, '*');
    }
    setOperatorColumns(pickerSelectedOperators);
    const evId = eventIdRef.current;
    if (evId) {
      for (const col of pickerSelectedOperators) {
        loadOperatorNotes(evId, col.userId);
      }
    }
    setShowColumnPicker(false);
  };

  const recallSavedOperator = (op: UserEventNoteOperator) => {
    const name = op.user_name?.trim() || operatorDisplayName(op);
    storeOperatorName(name);
    operatorUserIdRef.current = op.user_id;
    setOperatorName(name);
    setMyNotesEnabled(true);
    setShowNameModal(false);
    setNameDraft('');
    const evId = eventIdRef.current;
    if (evId) loadPersonalNotes(evId, op.user_id);
  };

  const getColFraction = useCallback(
    (col: DisplayColumn) => {
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

  const getGridColumn = (j: number) => (j === 0 ? 1 : 2 * j);
  const getHandleGridColumn = (j: number) => 2 * j + 1;

  const isMyNotesCol = (col: DisplayColumn): col is MyNotesColumnSpec => col.type === 'my-notes';
  const isOperatorNotesCol = (col: DisplayColumn): col is OperatorNotesColumnSpec =>
    col.type === 'operator-notes';

  return (
    <div className="min-h-screen min-w-0 w-full bg-slate-900 text-slate-100 font-sans box-border">
      <div className="min-w-0 w-full max-w-[100vw] mx-auto p-4 sm:p-6 box-border" style={{ width: '100%' }}>
        <header className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-600">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-white min-w-0">Notes popout</h1>
            {myNotesEnabled && operatorName && (
              <p className="text-emerald-300 text-sm mt-1">
                My notes as <span className="font-medium">{operatorName}</span> — saved to the cloud for this event
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {saveStatus === 'saving' && <span className="text-amber-300 text-sm">Saving…</span>}
            {saveStatus === 'saved' && <span className="text-emerald-400 text-sm">Saved</span>}
            {saveStatus === 'error' && <span className="text-red-400 text-sm">Save failed — is the API deployed?</span>}

            {!myNotesEnabled ? (
              operatorName ? (
                <button
                  type="button"
                  onClick={() => {
                    setMyNotesEnabled(true);
                    const evId = eventIdRef.current;
                    const opId = operatorUserId(operatorName);
                    operatorUserIdRef.current = opId;
                    if (evId) loadPersonalNotes(evId, opId);
                  }}
                  className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Show my notes ({operatorName})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openNameModal}
                  className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Set up my notes
                </button>
              )
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setMyNotesEnabled(false)}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg transition-colors"
                >
                  Hide my notes
                </button>
                <button
                  type="button"
                  onClick={openNameModal}
                  className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded-lg transition-colors"
                >
                  Change name
                </button>
              </>
            )}

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

        {showNameModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 w-full max-w-md shadow-xl">
              <h2 className="text-xl font-bold text-white mb-2">Your name</h2>
              <p className="text-slate-300 text-sm mb-4">
                Enter the name you want your notes saved under. Use the same name on any computer or browser to
                load your notes for this event.
              </p>
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && activateOperator(nameDraft)}
                placeholder="e.g. Sarah — Graphics"
                autoFocus
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white mb-4 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {operatorsLoadError && (
                <p className="text-amber-300 text-sm mb-3">{operatorsLoadError}</p>
              )}
              {savedOperators.length > 0 && (
                <div className="mb-4">
                  <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">
                    Load notes saved for this event
                  </p>
                  <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                    {savedOperators.map((op) => (
                      <button
                        key={op.user_id}
                        type="button"
                        onClick={() => recallSavedOperator(op)}
                        className="text-left px-3 py-2 bg-slate-700 hover:bg-emerald-800/60 border border-slate-600 hover:border-emerald-600 rounded-lg transition-colors"
                      >
                        <span className="text-white font-medium">{operatorDisplayName(op)}</span>
                        <span className="text-slate-400 text-xs ml-2">
                          {op.note_count} saved note{op.note_count === 1 ? '' : 's'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowNameModal(false)}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => activateOperator(nameDraft)}
                  disabled={!nameDraft.trim()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg"
                >
                  {operatorName ? 'Switch to this name' : 'Start my notes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showColumnPicker && (
          <div className="mb-6 p-4 bg-slate-800 rounded-xl border border-slate-600">
            <p className="text-slate-300 text-sm mb-3">
              Shared columns from the Run of Show (read-only here). Cue is always shown on the left.
            </p>
            <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Shared columns</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {(availableColumns.length > 0
                ? availableColumns
                : [{ type: 'notes' as const, id: 'notes', name: 'Notes' }]
              )
                .filter((col) => !(col.type === 'cue' && col.id === 'cue'))
                .map((col) => (
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

            <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">
              Operator notes saved for this event
            </p>
            {operatorsLoadError ? (
              <p className="text-amber-300 text-sm mb-4">{operatorsLoadError}</p>
            ) : savedOperators.length === 0 ? (
              <p className="text-slate-500 text-sm mb-4">
                No operator notes saved yet. Use &ldquo;Set up my notes&rdquo; to create yours — it will appear here
                for you and others to load as a column.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 mb-4">
                {savedOperators.map((op) => {
                  const col = operatorColumnFromSaved(op);
                  const isSelf = currentOpId === op.user_id;
                  return (
                    <label
                      key={op.user_id}
                      className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={pickerSelectedOperators.some((c) => c.userId === op.user_id)}
                        onChange={() => togglePickerOperator(op)}
                        className="w-4 h-4 rounded border-slate-500"
                      />
                      <span className="text-white text-sm">
                        {operatorDisplayName(op)}
                        {isSelf ? ' (you)' : ''}
                      </span>
                      <span className="text-slate-400 text-xs">
                        {op.note_count} note{op.note_count === 1 ? '' : 's'}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

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
              {displayColumns.map((col, j) => (
                <div
                  key={'h-' + colKey(col)}
                  style={{ gridColumn: getGridColumn(j), gridRow: 1 }}
                  className="px-3 py-2 bg-slate-700 border-b border-r border-slate-600 flex items-center gap-2 min-w-0"
                >
                  <h2 className="text-base font-bold text-white truncate">
                    {isMyNotesCol(col) ? 'My notes' : col.name}
                  </h2>
                  {isMyNotesCol(col) ? (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-800 text-emerald-200 flex-shrink-0">
                      Yours
                    </span>
                  ) : isOperatorNotesCol(col) ? (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-900 text-violet-200 flex-shrink-0">
                      Operator
                    </span>
                  ) : col.type !== 'cue' ? (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-600 text-slate-300 flex-shrink-0">
                      Shared
                    </span>
                  ) : null}
                </div>
              ))}

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

              {displayRows.map((item, rowIndex) =>
                displayColumns.map((col, colIndex) => {
                  const isCurrent = rowIndex === 0;
                  const label = isCurrent ? 'Current' : `Next ${rowIndex}`;

                  if (col.type === 'cue') {
                    const value = getSharedCellValue(item, col);
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

                  const value = isMyNotesCol(col)
                    ? personalNotes[personalNoteKey(item.id)] || ''
                    : isOperatorNotesCol(col)
                      ? operatorNotesByUser[col.userId]?.[personalNoteKey(item.id)] || ''
                      : getSharedCellValue(item, col);

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
                      {isMyNotesCol(col) ? (
                        <textarea
                          value={value}
                          onChange={(e) => handlePersonalNoteChange(item.id, e.target.value)}
                          placeholder="Your private notes for this cue…"
                          className="w-full flex-1 min-h-[6rem] resize-y bg-slate-900/80 border border-emerald-700/50 rounded-md p-2 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                        />
                      ) : isOperatorNotesCol(col) ? (
                        <div className="text-left whitespace-pre-wrap break-words text-violet-100 text-sm flex-1 min-h-0 overflow-auto bg-violet-950/20 border border-violet-800/40 rounded-md p-2">
                          <span className={value ? '' : 'text-slate-500'}>{value || '—'}</span>
                        </div>
                      ) : (
                        <div className="text-left whitespace-pre-wrap break-words text-slate-200 text-sm flex-1 min-h-0 overflow-auto">
                          {col.type === 'notes' && value ? (
                            <div
                              className="notes-display prose prose-invert prose-sm max-w-none"
                              dangerouslySetInnerHTML={{ __html: value }}
                            />
                          ) : (
                            <span className={value ? '' : 'text-slate-500'}>{value || '—'}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {columns.length === 0 && !myNotesEnabled && displayRows.length > 0 && (
          <p className="text-slate-500 mt-3">
            Only Cue shown. Use &ldquo;Change columns&rdquo; for shared ROS columns, or &ldquo;Set up my notes&rdquo; for
            your private column.
          </p>
        )}
      </div>
    </div>
  );
};

export default PinNotesPopoutPage;
