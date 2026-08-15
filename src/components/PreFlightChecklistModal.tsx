import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiClient, type PreflightChecklistItemRow } from '../services/api-client';
import {
  PREFLIGHT_SECTIONS,
  summarizePreflightProgress,
  type PreflightSection,
} from '../lib/preflightChecklist';

interface PreFlightChecklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  eventName?: string;
  day?: number;
  numberOfDays?: number;
  userId: string;
  userName?: string;
  onProgressChange?: (progress: { total: number; checked: number; complete: boolean }) => void;
}

function formatWhen(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const PreFlightChecklistModal: React.FC<PreFlightChecklistModalProps> = ({
  isOpen,
  onClose,
  eventId,
  eventName,
  day = 1,
  numberOfDays = 1,
  userId,
  userName,
  onProgressChange,
}) => {
  const [items, setItems] = useState<PreflightChecklistItemRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addSection, setAddSection] = useState<PreflightSection>('Lighting');
  const [addLabel, setAddLabel] = useState('');
  const [adding, setAdding] = useState(false);

  const dayNum = Math.max(1, Math.floor(Number(day) || 1));
  const multiDay = Math.max(1, Math.floor(Number(numberOfDays) || 1)) > 1;
  const progress = useMemo(() => summarizePreflightProgress(items), [items]);

  const load = async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getPreflightChecklist(eventId, dayNum);
      setItems(res?.items || []);
      if (res?.progress) onProgressChange?.(res.progress);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load checklist');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !eventId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, eventId, dayNum]);

  useEffect(() => {
    onProgressChange?.(progress);
  }, [progress, onProgressChange]);

  if (!isOpen) return null;

  const toggleItem = async (item: PreflightChecklistItemRow) => {
    setSavingId(item.id);
    setError(null);
    try {
      const updated = await apiClient.updatePreflightChecklistItem(item.id, {
        is_checked: !item.is_checked,
        user_id: userId,
        user_name: userName,
      });
      setItems((prev) => prev.map((row) => (row.id === item.id ? updated : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item');
    } finally {
      setSavingId(null);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const label = addLabel.trim();
    if (!label) {
      setError('Enter an item label.');
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const created = await apiClient.createPreflightChecklistItem({
        event_id: eventId,
        section: addSection,
        label,
        day: dayNum,
      });
      setItems((prev) => [...prev, created]);
      setAddLabel('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item');
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteCustom = async (item: PreflightChecklistItemRow) => {
    if (!item.is_custom) return;
    if (!window.confirm(`Remove “${item.label}” from this checklist?`)) return;
    setSavingId(item.id);
    setError(null);
    try {
      await apiClient.deletePreflightChecklistItem(item.id);
      setItems((prev) => prev.filter((row) => row.id !== item.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete item');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 py-6">
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-600 bg-slate-800 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preflight-checklist-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-5 py-4">
          <div>
            <h2 id="preflight-checklist-title" className="text-lg font-semibold text-white">
              Pre-Flight / Show Checklist
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {eventName || 'Event'}
              {multiDay ? ` · Day ${dayNum}` : ''} · {progress.checked}/{progress.total} complete
              {progress.complete ? ' · Ready' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none text-slate-400 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? <p className="text-sm text-slate-400">Loading checklist…</p> : null}
          {error ? <p className="mb-3 text-sm text-red-300">{error}</p> : null}

          {!loading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {PREFLIGHT_SECTIONS.map((section) => {
                const sectionItems = items.filter((i) => i.section === section);
                const done = sectionItems.filter((i) => i.is_checked).length;
                return (
                  <section
                    key={section}
                    className="rounded-lg border border-slate-600 bg-slate-900/60 p-3"
                  >
                    <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-slate-700 pb-2">
                      <h3 className="text-sm font-semibold text-white">{section}</h3>
                      <span className="text-xs text-slate-400">
                        {done}/{sectionItems.length}
                      </span>
                    </div>
                    {sectionItems.length === 0 ? (
                      <p className="text-xs text-slate-500">No items in this category.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {sectionItems.map((item) => (
                          <li key={item.id} className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 accent-blue-500"
                              checked={item.is_checked}
                              disabled={savingId === item.id}
                              onChange={() => void toggleItem(item)}
                              aria-label={item.label}
                            />
                            <div className="min-w-0 flex-1">
                              <div
                                className={`text-sm ${
                                  item.is_checked ? 'text-slate-400 line-through' : 'text-slate-200'
                                }`}
                              >
                                {item.label}
                                {item.is_custom ? (
                                  <span className="ml-1.5 text-[10px] font-medium uppercase text-amber-400">
                                    Event
                                  </span>
                                ) : null}
                              </div>
                              {item.is_checked && item.checked_by_name ? (
                                <div className="text-[11px] text-slate-500">
                                  {item.checked_by_name}
                                  {item.checked_at ? ` · ${formatWhen(item.checked_at)}` : ''}
                                </div>
                              ) : null}
                            </div>
                            {item.is_custom ? (
                              <button
                                type="button"
                                onClick={() => void handleDeleteCustom(item)}
                                disabled={savingId === item.id}
                                className="rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-red-300"
                                title="Remove event-specific item"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          ) : null}

          <form
            onSubmit={(e) => void handleAdd(e)}
            className="mt-4 rounded-lg border border-slate-600 bg-slate-900/40 p-3"
          >
            <p className="mb-2 text-xs font-medium text-slate-400">Add item for this event only</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={addSection}
                onChange={(e) => setAddSection(e.target.value as PreflightSection)}
                className="rounded-lg border border-slate-600 bg-slate-700 px-2 py-2 text-sm text-white"
              >
                {PREFLIGHT_SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                placeholder="e.g. Panel of 4 lavs"
                className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-400"
              />
              <button
                type="submit"
                disabled={adding}
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            </div>
          </form>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-700 px-5 py-3">
          <p className="text-xs text-slate-500">
            {multiDay
              ? `Editing Day ${dayNum}. Switch the schedule day to work another day.`
              : 'Standard items come from Admin · event items stay on this show only.'}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default PreFlightChecklistModal;
