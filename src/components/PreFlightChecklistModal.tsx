import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const [activeSection, setActiveSection] = useState<PreflightSection>('Lighting');
  const listRef = useRef<HTMLDivElement>(null);

  const dayNum = Math.max(1, Math.floor(Number(day) || 1));
  const multiDay = Math.max(1, Math.floor(Number(numberOfDays) || 1)) > 1;
  const progress = useMemo(() => summarizePreflightProgress(items), [items]);
  const sectionIndex = PREFLIGHT_SECTIONS.indexOf(activeSection);
  const prevSection = sectionIndex > 0 ? PREFLIGHT_SECTIONS[sectionIndex - 1] : null;
  const nextSection =
    sectionIndex >= 0 && sectionIndex < PREFLIGHT_SECTIONS.length - 1
      ? PREFLIGHT_SECTIONS[sectionIndex + 1]
      : null;
  const activeItems = useMemo(
    () => items.filter((i) => i.section === activeSection),
    [items, activeSection]
  );
  const activeDone = activeItems.filter((i) => i.is_checked).length;

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

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [activeSection]);

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
      setActiveSection(addSection);
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
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-600 bg-slate-800 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preflight-checklist-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-5 py-4">
          <div>
            <h2 id="preflight-checklist-title" className="text-xl font-semibold text-white">
              Pre-Flight / Show Checklist
            </h2>
            <p className="mt-1 text-sm text-slate-400">
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

        <div className="border-b border-slate-700 px-4 pt-3">
          <div className="flex gap-1 overflow-x-auto pb-px">
            {PREFLIGHT_SECTIONS.map((section) => {
              const sectionItems = items.filter((i) => i.section === section);
              const done = sectionItems.filter((i) => i.is_checked).length;
              const selected = activeSection === section;
              return (
                <button
                  key={section}
                  type="button"
                  onClick={() => {
                    setActiveSection(section);
                    setAddSection(section);
                  }}
                  className={`shrink-0 rounded-t-lg border-b-2 px-3 py-2.5 text-left transition-colors ${
                    selected
                      ? 'border-blue-400 bg-slate-900/70 text-white'
                      : 'border-transparent text-slate-400 hover:bg-slate-700/50 hover:text-white'
                  }`}
                >
                  <div className="text-sm font-semibold sm:text-base">{section}</div>
                  <div className={`text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
                    {sectionItems.length ? `${done}/${sectionItems.length}` : '—'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? <p className="text-base text-slate-400">Loading checklist…</p> : null}
          {error ? <p className="mb-3 text-base text-red-300">{error}</p> : null}

          {!loading ? (
            <section className="rounded-lg border border-slate-600 bg-slate-900/60 p-4">
              <div className="mb-4 flex items-center justify-between gap-2 border-b border-slate-700 pb-3">
                <h3 className="text-lg font-semibold text-white sm:text-xl">{activeSection}</h3>
                <span className="text-sm text-slate-400">
                  {activeDone}/{activeItems.length}
                </span>
              </div>
              {activeItems.length === 0 ? (
                <p className="py-6 text-base text-slate-500">No items in this category.</p>
              ) : (
                <ul className="space-y-3">
                  {activeItems.map((item) => (
                    <li key={item.id}>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-700/80 bg-slate-800/50 px-3 py-3 hover:border-slate-500">
                        <input
                          type="checkbox"
                          className="mt-1 h-6 w-6 shrink-0 accent-blue-500"
                          checked={item.is_checked}
                          disabled={savingId === item.id}
                          onChange={() => void toggleItem(item)}
                          aria-label={item.label}
                        />
                        <div className="min-w-0 flex-1">
                          <div
                            className={`text-base leading-snug sm:text-lg ${
                              item.is_checked ? 'text-slate-400 line-through' : 'text-white'
                            }`}
                          >
                            {item.label}
                            {item.is_custom ? (
                              <span className="ml-2 align-middle text-xs font-medium uppercase text-amber-400">
                                Event
                              </span>
                            ) : null}
                          </div>
                          {item.is_checked && item.checked_by_name ? (
                            <div className="mt-1 text-sm text-slate-500">
                              {item.checked_by_name}
                              {item.checked_at ? ` · ${formatWhen(item.checked_at)}` : ''}
                            </div>
                          ) : null}
                        </div>
                        {item.is_custom ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              void handleDeleteCustom(item);
                            }}
                            disabled={savingId === item.id}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-700 hover:text-red-300"
                            title="Remove event-specific item"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        ) : null}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={!prevSection}
                  onClick={() => {
                    if (!prevSection) return;
                    setActiveSection(prevSection);
                    setAddSection(prevSection);
                  }}
                  className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ← {prevSection || 'Previous'}
                </button>
                <button
                  type="button"
                  disabled={!nextSection}
                  onClick={() => {
                    if (!nextSection) return;
                    setActiveSection(nextSection);
                    setAddSection(nextSection);
                  }}
                  className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {nextSection || 'Next'} →
                </button>
              </div>
            </section>
          ) : null}

          <form
            onSubmit={(e) => void handleAdd(e)}
            className="mt-4 rounded-lg border border-slate-600 bg-slate-900/40 p-4"
          >
            <p className="mb-2 text-sm font-medium text-slate-400">Add item for this event only</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={addSection}
                onChange={(e) => setAddSection(e.target.value as PreflightSection)}
                className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-2.5 text-base text-white"
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
                className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-2.5 text-base text-white placeholder:text-slate-400"
              />
              <button
                type="submit"
                disabled={adding}
                className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-4 py-2.5 text-base font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                <Plus className="h-5 w-5" />
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
