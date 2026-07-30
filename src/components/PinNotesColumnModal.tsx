import React, { useEffect, useState } from 'react';
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

  const sharedOptions: PinNotesColumn[] = [
    { type: 'notes', id: 'notes', name: 'Notes' },
    ...customColumns.map((c) => ({ type: 'custom' as const, id: c.id, name: c.name })),
  ];

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
      <div className="bg-slate-800 rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">Notes popout</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl">
            ×
          </button>
        </div>
        <p className="text-slate-300 text-sm mb-5">
          Choose what to show before opening. Cue always appears on the left. You can still change
          columns later from the popout if needed.
        </p>

        <div className="mb-5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-slate-400 text-xs uppercase tracking-wide">Shared columns</p>
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
          <div className="space-y-2">
            {sharedOptions.map((col) => (
              <label
                key={col.type + col.id}
                className="flex items-center gap-3 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={isSelected(col)}
                  onChange={() => toggle(col)}
                  className="w-5 h-5 rounded border-slate-500"
                />
                <span className="text-white font-medium">{col.name}</span>
                {col.type === 'notes' ? (
                  <span className="text-slate-400 text-xs ml-auto">ROS Notes</span>
                ) : (
                  <span className="text-slate-400 text-xs ml-auto">Custom</span>
                )}
              </label>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Users&apos; notes</p>
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
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {savedOperators.map((op) => {
                const checked = selectedOperators.some((c) => c.userId === op.user_id);
                const busy = deletingUserId === op.user_id;
                return (
                  <div
                    key={op.user_id}
                    className="flex items-center gap-2 px-3 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                  >
                    <label className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOperator(op)}
                        className="w-5 h-5 rounded border-slate-500 flex-shrink-0"
                      />
                      <span className="text-white font-medium truncate">{operatorLabel(op)}</span>
                      <span className="text-slate-400 text-xs flex-shrink-0">
                        {op.note_count} note{op.note_count === 1 ? '' : 's'}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => void deleteOperatorNotes(op)}
                      disabled={busy}
                      className="px-2 py-1 text-xs text-red-300 hover:text-white hover:bg-red-700/80 border border-red-800/60 rounded disabled:opacity-50 flex-shrink-0"
                      title={`Delete all notes for ${operatorLabel(op)}`}
                    >
                      {busy ? '…' : 'Delete'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {manageError ? <p className="text-red-300 text-sm mt-2">{manageError}</p> : null}
          <p className="text-slate-500 text-xs mt-2">
            Delete removes that person&apos;s saved notes for this event only.
          </p>
        </div>

        <div className="mb-6 p-4 bg-slate-900/60 border border-slate-600 rounded-lg">
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
                  {savedOperators.slice(0, 8).map((op) => {
                    const label = operatorLabel(op);
                    return (
                      <button
                        key={`use-${op.user_id}`}
                        type="button"
                        onClick={() => setMyNotesName(op.user_name?.trim() || label)}
                        className="px-2 py-1 text-xs bg-slate-700 hover:bg-emerald-800/50 text-slate-200 rounded border border-slate-600"
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
