import React, { useEffect, useMemo, useState } from 'react';
import { apiClient, type UserEventNoteOperator } from '../services/api-client';
import {
  getStoredOperatorName,
  personColumnLabel,
  storeOperatorName,
} from '../lib/pinNotesOperator';

export type PinNotesColumn = { type: 'notes' | 'custom' | 'cue'; id: string; name: string };

export type PinNotesOperatorColumn = {
  type: 'operator-notes';
  id: string;
  userId: string;
  name: string;
};

export type PinNotesLaunchConfig = {
  columns: PinNotesColumn[];
  operatorColumns: PinNotesOperatorColumn[];
  enableMyNotes: boolean;
  myNotesName: string | null;
};

export const PIN_NOTES_LAUNCH_KEY = 'ros_pin_notes_launch';

interface PinNotesColumnModalProps {
  eventId?: string | null;
  customColumns: { id: string; name: string }[];
  onClose: () => void;
  onOpen: (config: PinNotesLaunchConfig) => void;
}

const PinNotesColumnModal: React.FC<PinNotesColumnModalProps> = ({
  eventId,
  customColumns,
  onClose,
  onOpen,
}) => {
  const [selected, setSelected] = useState<PinNotesColumn[]>([
    { type: 'notes', id: 'notes', name: 'Notes' },
  ]);
  const [selectedOperators, setSelectedOperators] = useState<PinNotesOperatorColumn[]>([]);
  const [enableMyNotes, setEnableMyNotes] = useState(() => !!getStoredOperatorName());
  const [myNotesName, setMyNotesName] = useState(() => getStoredOperatorName() || '');
  const [savedOperators, setSavedOperators] = useState<UserEventNoteOperator[]>([]);
  const [operatorsError, setOperatorsError] = useState<string | null>(null);
  const [loadingOperators, setLoadingOperators] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [columnSearch, setColumnSearch] = useState('');
  const [peopleSearch, setPeopleSearch] = useState('');

  const operatorLabel = (op: UserEventNoteOperator) =>
    personColumnLabel(
      op.user_name?.trim() || op.user_id.replace(/^operator:/, '').replace(/-/g, ' ')
    );

  const refreshOperators = async () => {
    if (!eventId) return;
    setLoadingOperators(true);
    try {
      const data = await apiClient.listUserEventNoteOperators(eventId);
      setSavedOperators(data.operators || []);
      setOperatorsError(null);
    } catch (error) {
      setSavedOperators([]);
      const message = error instanceof Error ? error.message : '';
      setOperatorsError(
        message.includes('404')
          ? 'Saved people notes are not available from the API yet.'
          : 'Could not load saved people notes.'
      );
    } finally {
      setLoadingOperators(false);
    }
  };

  useEffect(() => {
    if (!eventId) return;
    void refreshOperators();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when event changes
  }, [eventId]);

  const deleteOperatorNotes = async (op: UserEventNoteOperator) => {
    if (!eventId) return;
    const label = operatorLabel(op);
    const ok = window.confirm(
      `Delete all notes saved under "${label}" for this event?\n\nThis cannot be undone.`
    );
    if (!ok) return;
    setDeletingUserId(op.user_id);
    setManageError(null);
    try {
      await apiClient.deleteUserEventNotes(eventId, op.user_id);
      setSelectedOperators((prev) => prev.filter((c) => c.userId !== op.user_id));
      await refreshOperators();
    } catch {
      setManageError(`Could not delete notes for ${label}. Redeploy the Railway API, then try again.`);
    } finally {
      setDeletingUserId(null);
    }
  };

  const toggle = (col: PinNotesColumn) => {
    setSelected((prev) => {
      const has = prev.some((c) => c.id === col.id && c.type === col.type);
      if (has) return prev.filter((c) => !(c.id === col.id && c.type === col.type));
      return [...prev, col];
    });
  };

  const isSelected = (col: PinNotesColumn) =>
    selected.some((c) => c.id === col.id && c.type === col.type);

  const toggleOperator = (op: UserEventNoteOperator) => {
    const label = operatorLabel(op);
    setSelectedOperators((prev) => {
      const has = prev.some((c) => c.userId === op.user_id);
      if (has) return prev.filter((c) => c.userId !== op.user_id);
      return [
        ...prev,
        {
          type: 'operator-notes',
          id: op.user_id,
          userId: op.user_id,
          name: label,
        },
      ];
    });
  };

  const sharedOptions = useMemo<PinNotesColumn[]>(
    () => [
      { type: 'notes', id: 'notes', name: 'Notes' },
      ...customColumns.map((c) => ({ type: 'custom' as const, id: c.id, name: c.name })),
    ],
    [customColumns]
  );

  const filteredShared = useMemo(() => {
    const q = columnSearch.trim().toLowerCase();
    if (!q) return sharedOptions;
    return sharedOptions.filter((c) => c.name.toLowerCase().includes(q));
  }, [sharedOptions, columnSearch]);

  const filteredOperators = useMemo(() => {
    const q = peopleSearch.trim().toLowerCase();
    if (!q) return savedOperators;
    return savedOperators.filter((op) => {
      const label = personColumnLabel(
        op.user_name?.trim() || op.user_id.replace(/^operator:/, '').replace(/-/g, ' ')
      );
      return label.toLowerCase().includes(q);
    });
  }, [savedOperators, peopleSearch]);

  const trimmedName = myNotesName.trim();
  const canOpen =
    selected.length > 0 ||
    selectedOperators.length > 0 ||
    (enableMyNotes && !!trimmedName);

  const handleOpen = () => {
    if (!canOpen) return;
    if (enableMyNotes && trimmedName) {
      storeOperatorName(trimmedName);
    }
    onOpen({
      columns: selected,
      operatorColumns: selectedOperators,
      enableMyNotes: enableMyNotes && !!trimmedName,
      myNotesName: enableMyNotes && trimmedName ? trimmedName : null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg p-5 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-xl font-bold text-white">Notes popout</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl">
            ×
          </button>
        </div>
        <p className="text-slate-300 text-sm mb-4">
          Pick columns left-to-right. Cue stays on the left. Search helps when there are many custom
          columns or people.
        </p>

        <div className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-slate-400 text-xs uppercase tracking-wide">
              Shared columns
              <span className="normal-case tracking-normal text-slate-500 ml-2">
                {selected.length} selected · {sharedOptions.length} available
              </span>
            </p>
            <div className="flex items-center gap-2">
              {sharedOptions.length > 8 ? (
                <input
                  type="search"
                  value={columnSearch}
                  onChange={(e) => setColumnSearch(e.target.value)}
                  placeholder="Search columns…"
                  className="w-40 px-2 py-1 text-xs bg-slate-900 border border-slate-600 rounded text-white placeholder-slate-500"
                />
              ) : null}
              {selected.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelected([])}
                  className="text-xs text-slate-400 hover:text-white underline"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto content-start rounded-lg border border-slate-700/80 bg-slate-900/30 p-2">
            {filteredShared.length === 0 ? (
              <p className="text-slate-500 text-sm px-1 py-2">No columns match.</p>
            ) : (
              filteredShared.map((col) => {
                const on = isSelected(col);
                return (
                  <button
                    key={col.type + col.id}
                    type="button"
                    onClick={() => toggle(col)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      on
                        ? 'border-blue-500 bg-blue-900/45 text-blue-50'
                        : 'border-slate-600 bg-slate-700/70 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        on ? 'bg-blue-400' : 'bg-slate-500'
                      }`}
                    />
                    <span className="font-medium truncate max-w-[12rem]">{col.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      {col.type === 'notes' ? 'ros' : 'custom'}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-slate-400 text-xs uppercase tracking-wide">
              Users&apos; notes
              <span className="normal-case tracking-normal text-slate-500 ml-2">
                {selectedOperators.length} selected · {savedOperators.length} people
              </span>
            </p>
            {savedOperators.length > 6 ? (
              <input
                type="search"
                value={peopleSearch}
                onChange={(e) => setPeopleSearch(e.target.value)}
                placeholder="Search people…"
                className="w-40 px-2 py-1 text-xs bg-slate-900 border border-slate-600 rounded text-white placeholder-slate-500"
              />
            ) : null}
          </div>
          {loadingOperators ? (
            <p className="text-slate-400 text-sm">Loading saved people…</p>
          ) : operatorsError ? (
            <p className="text-amber-300 text-sm">{operatorsError}</p>
          ) : savedOperators.length === 0 ? (
            <p className="text-slate-500 text-sm">
              No one has saved notes for this event yet. Use &ldquo;Make your notes&rdquo; below to create
              yours.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto content-start rounded-lg border border-slate-700/80 bg-slate-900/30 p-2">
              {filteredOperators.length === 0 ? (
                <p className="text-slate-500 text-sm px-1 py-2">No people match.</p>
              ) : (
                filteredOperators.map((op) => {
                  const checked = selectedOperators.some((c) => c.userId === op.user_id);
                  const busy = deletingUserId === op.user_id;
                  const label = operatorLabel(op);
                  return (
                    <div
                      key={op.user_id}
                      className={`inline-flex items-center gap-1 rounded-full border pl-2.5 pr-1 py-1 ${
                        checked
                          ? 'border-emerald-500/70 bg-emerald-950/40 text-emerald-50'
                          : 'border-slate-600 bg-slate-700/70 text-slate-300'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleOperator(op)}
                        className="inline-flex items-center gap-1.5 min-w-0"
                        title={`${label} · ${op.note_count} notes`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            checked ? 'bg-emerald-400' : 'bg-slate-500'
                          }`}
                        />
                        <span className="text-sm font-medium truncate max-w-[9rem]">{label}</span>
                        <span className="text-[10px] text-slate-500 tabular-nums">{op.note_count}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteOperatorNotes(op)}
                        disabled={busy}
                        className="ml-0.5 px-1.5 py-0.5 text-[10px] text-red-300 hover:text-white hover:bg-red-700/80 rounded-full disabled:opacity-50"
                        title={`Delete all notes for ${label}`}
                      >
                        {busy ? '…' : '×'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
          {manageError ? <p className="text-red-300 text-sm mt-2">{manageError}</p> : null}
          <p className="text-slate-500 text-xs mt-2">
            × removes that person&apos;s saved notes for this event only.
          </p>
        </div>

        <div className="mb-5 p-4 bg-slate-900/60 border border-slate-600 rounded-lg">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enableMyNotes}
              onChange={(e) => setEnableMyNotes(e.target.checked)}
              className="w-5 h-5 mt-0.5 rounded border-slate-500"
            />
            <div className="min-w-0 flex-1">
              <div className="text-white font-medium">Make your notes</div>
              <p className="text-slate-400 text-xs mt-0.5">
                Add a private editable column under your name. Same name on any browser loads the same
                notes for this event.
              </p>
            </div>
          </label>
          {enableMyNotes && (
            <div className="mt-3 pl-8">
              <input
                type="text"
                value={myNotesName}
                onChange={(e) => setMyNotesName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleOpen()}
                placeholder="Your name (e.g. Sarah)"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {savedOperators.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {savedOperators.slice(0, 12).map((op) => {
                    const label = operatorLabel(op);
                    return (
                      <button
                        key={`use-${op.user_id}`}
                        type="button"
                        onClick={() => setMyNotesName(op.user_name?.trim() || label)}
                        className="px-2 py-1 text-xs bg-slate-700 hover:bg-emerald-800/50 text-slate-200 rounded-full border border-slate-600"
                      >
                        Use {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleOpen}
            disabled={!canOpen}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            Open popout
          </button>
        </div>
      </div>
    </div>
  );
};

export default PinNotesColumnModal;
