import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessAdmin } from '../services/auth-service';
import {
  FEATURE_UPDATE_CATEGORIES,
  fetchFeatureUpdates,
  newFeatureItem,
  newFeatureMonth,
  newFeatureWeek,
  saveFeatureUpdates,
  withDefaultsIfEmpty,
  type FeatureUpdateCategory,
  type FeatureUpdateMonth,
  type FeatureUpdateWeek,
} from '../lib/featureUpdates';

function categoryClass(category?: FeatureUpdateCategory): string {
  switch (category) {
    case 'System Update':
      return 'border-violet-600/60 bg-violet-950/50 text-violet-200';
    case 'Fix':
      return 'border-amber-700/60 bg-amber-950/40 text-amber-200';
    case 'Ops':
      return 'border-slate-500/60 bg-slate-800/80 text-slate-300';
    case 'Feature':
    default:
      return 'border-sky-600/60 bg-sky-950/50 text-sky-200';
  }
}

function WeekBlock({
  week,
  open,
  onToggle,
  editing,
  isAdmin,
  onChangeWeek,
  onRemoveWeek,
}: {
  week: FeatureUpdateWeek;
  open: boolean;
  onToggle: () => void;
  editing: boolean;
  isAdmin: boolean;
  onChangeWeek: (next: FeatureUpdateWeek) => void;
  onRemoveWeek: () => void;
}) {
  const approvedCount = week.items.filter((it) => it.approved).length;

  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-900/70 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/60 transition-colors"
        aria-expanded={open}
      >
        <span
          className={`text-sky-400 text-sm leading-none transition-transform ${open ? 'rotate-90' : ''}`}
        >
          ▸
        </span>
        <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          {editing ? (
            <>
              <input
                value={week.label}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onChangeWeek({ ...week, label: e.target.value })}
                className="rounded-md border border-slate-600 bg-slate-950 px-2.5 py-1 text-base font-semibold text-sky-100"
                placeholder="Week label"
              />
              <input
                value={week.rangeLabel}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onChangeWeek({ ...week, rangeLabel: e.target.value })}
                className="rounded-md border border-slate-600 bg-slate-950 px-2.5 py-1 text-sm text-slate-300"
                placeholder="Date range"
              />
            </>
          ) : (
            <>
              <h3 className="text-base font-semibold text-sky-200">{week.label}</h3>
              {week.rangeLabel ? (
                <span className="text-sm text-slate-400">{week.rangeLabel}</span>
              ) : null}
            </>
          )}
          <span className="text-xs text-slate-500">
            {isAdmin && !editing
              ? `${approvedCount}/${week.items.length} approved`
              : `${week.items.length} update${week.items.length === 1 ? '' : 's'}`}
          </span>
        </div>
        {editing ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveWeek();
            }}
            className="shrink-0 text-xs text-red-300 hover:text-red-200"
          >
            Remove week
          </button>
        ) : null}
      </button>

      {open ? (
        <div className="border-t border-slate-700/70 px-4 py-4">
          {editing ? (
            <div className="space-y-4">
              {week.items.map((entry) => (
                <div key={entry.id} className="flex gap-3 items-start">
                  <span className="mt-3 text-sky-400 text-lg leading-none" aria-hidden>
                    •
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <input
                      value={entry.title}
                      onChange={(e) => {
                        const items = week.items.map((it) =>
                          it.id === entry.id ? { ...it, title: e.target.value } : it
                        );
                        onChangeWeek({ ...week, items });
                      }}
                      className="w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-base font-semibold text-white"
                      placeholder="Short title"
                    />
                    <textarea
                      value={entry.detail || ''}
                      rows={3}
                      onChange={(e) => {
                        const items = week.items.map((it) =>
                          it.id === entry.id
                            ? { ...it, detail: e.target.value || undefined }
                            : it
                        );
                        onChangeWeek({ ...week, items });
                      }}
                      className="w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-200 leading-relaxed"
                      placeholder="What changed, how to use it, why it matters"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={entry.category || 'Feature'}
                        onChange={(e) => {
                          const items = week.items.map((it) =>
                            it.id === entry.id
                              ? {
                                  ...it,
                                  category: e.target.value as FeatureUpdateCategory,
                                }
                              : it
                          );
                          onChangeWeek({ ...week, items });
                        }}
                        className="rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                      >
                        {FEATURE_UPDATE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <label className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                        <input
                          type="checkbox"
                          checked={entry.approved === true}
                          onChange={(e) => {
                            const items = week.items.map((it) =>
                              it.id === entry.id ? { ...it, approved: e.target.checked } : it
                            );
                            onChangeWeek({ ...week, items });
                          }}
                        />
                        Approve (public)
                      </label>
                      <input
                        value={entry.forWho || ''}
                        onChange={(e) => {
                          const items = week.items.map((it) =>
                            it.id === entry.id
                              ? { ...it, forWho: e.target.value || undefined }
                              : it
                          );
                          onChangeWeek({ ...week, items });
                        }}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300"
                        placeholder="Audience (optional)"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const items = week.items.filter((it) => it.id !== entry.id);
                          onChangeWeek({ ...week, items });
                        }}
                        className="text-xs text-red-300 hover:text-red-200"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  onChangeWeek({
                    ...week,
                    items: [...week.items, newFeatureItem('')],
                  })
                }
                className="ml-5 text-sm text-sky-300 hover:text-sky-200"
              >
                + Add bullet
              </button>
            </div>
          ) : week.items.length ? (
            <ul className="list-none space-y-5 pl-0">
              {week.items.map((entry) => (
                <li key={entry.id} className="flex gap-3 items-start">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" aria-hidden />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${categoryClass(entry.category)}`}
                      >
                        {entry.category || 'Feature'}
                      </span>
                      {isAdmin && !entry.approved ? (
                        <span className="rounded border border-slate-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Draft
                        </span>
                      ) : null}
                      {isAdmin && entry.approved ? (
                        <span className="rounded border border-emerald-700/60 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                          Public
                        </span>
                      ) : null}
                    </div>
                    <p className="text-base font-semibold text-white leading-snug">
                      {entry.title}
                      {entry.forWho ? (
                        <span className="ml-2 text-xs font-normal text-slate-500">{entry.forWho}</span>
                      ) : null}
                    </p>
                    {entry.detail ? (
                      <p className="mt-1.5 text-[0.95rem] text-slate-300 leading-relaxed">
                        {entry.detail}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No updates in this week yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MonthSection({
  month,
  open,
  onToggle,
  editing,
  isAdmin,
  onChangeMonth,
  onRemoveMonth,
}: {
  month: FeatureUpdateMonth;
  open: boolean;
  onToggle: () => void;
  editing: boolean;
  isAdmin: boolean;
  onChangeMonth: (next: FeatureUpdateMonth) => void;
  onRemoveMonth: () => void;
}) {
  const [openWeekIds, setOpenWeekIds] = useState<Set<string>>(() =>
    month.weeks[0] ? new Set([month.weeks[0].id]) : new Set()
  );

  useEffect(() => {
    if (!open) return;
    setOpenWeekIds((prev) => {
      if (prev.size) return prev;
      return month.weeks[0] ? new Set([month.weeks[0].id]) : new Set();
    });
  }, [open, month.weeks]);

  const toggleWeek = (weekId: string) => {
    setOpenWeekIds((prev) => {
      const next = new Set(prev);
      if (next.has(weekId)) next.delete(weekId);
      else next.add(weekId);
      return next;
    });
  };

  const updateWeek = (weekId: string, next: FeatureUpdateWeek) => {
    onChangeMonth({
      ...month,
      weeks: month.weeks.map((w) => (w.id === weekId ? next : w)),
    });
  };

  const removeWeek = (weekId: string) => {
    onChangeMonth({ ...month, weeks: month.weeks.filter((w) => w.id !== weekId) });
    setOpenWeekIds((prev) => {
      const next = new Set(prev);
      next.delete(weekId);
      return next;
    });
  };

  const addWeek = () => {
    const week = newFeatureWeek(`Week ${month.weeks.length + 1}`, '');
    onChangeMonth({
      ...month,
      weeks: [...month.weeks, week],
    });
    setOpenWeekIds((prev) => new Set(prev).add(week.id));
  };

  const total = month.weeks.reduce((n, w) => n + w.items.length, 0);
  const approved = month.weeks.reduce((n, w) => n + w.items.filter((i) => i.approved).length, 0);

  return (
    <section className="rounded-2xl border border-slate-600/80 bg-slate-800/50 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-800/80 transition-colors"
        aria-expanded={open}
      >
        <span className={`text-sky-300 text-lg leading-none transition-transform ${open ? 'rotate-90' : ''}`}>
          ▸
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              value={month.label}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onChangeMonth({ ...month, label: e.target.value })}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-1.5 text-lg font-bold text-white"
            />
          ) : (
            <h2 className="text-xl font-bold text-white tracking-tight">{month.label}</h2>
          )}
          <p className="text-sm text-slate-400 mt-0.5">
            {month.weeks.length
              ? isAdmin
                ? `${approved}/${total} approved · ${month.weeks.length} weeks`
                : `${total} updates · ${month.weeks.length} weeks`
              : month.emptyMessage || 'No updates yet'}
          </p>
        </div>
        {editing ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`Remove ${month.label}?`)) onRemoveMonth();
            }}
            className="shrink-0 rounded-md border border-red-700/60 bg-red-950/40 px-2.5 py-1 text-xs text-red-200 hover:bg-red-900/50"
          >
            Delete month
          </button>
        ) : null}
      </button>

      {open ? (
        <div className="border-t border-slate-700/80 bg-slate-950/60 px-5 sm:px-6 py-5 space-y-3">
          {!month.weeks.length ? (
            <p className="text-base text-slate-400">{month.emptyMessage || 'Coming soon.'}</p>
          ) : (
            month.weeks.map((week) => (
              <WeekBlock
                key={week.id}
                week={week}
                open={openWeekIds.has(week.id)}
                onToggle={() => toggleWeek(week.id)}
                editing={editing}
                isAdmin={isAdmin}
                onChangeWeek={(next) => updateWeek(week.id, next)}
                onRemoveWeek={() => removeWeek(week.id)}
              />
            ))
          )}

          {editing ? (
            <button
              type="button"
              onClick={addWeek}
              className="w-full rounded-xl border border-dashed border-slate-500 px-3 py-2.5 text-sm text-slate-300 hover:border-sky-500 hover:text-sky-200"
            >
              + Add week
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const FeatureUpdatesPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = canAccessAdmin(user);

  const [months, setMonths] = useState<FeatureUpdateMonth[]>([]);
  const [openMonthId, setOpenMonthId] = useState<string>('2026-09');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FeatureUpdateMonth[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMeta, setSavedMeta] = useState<{ at?: string | null; by?: string | null }>({});
  const [usingBuiltInDraft, setUsingBuiltInDraft] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (isAdmin) {
        const doc = await fetchFeatureUpdates({ admin: true });
        if (doc.empty || !doc.months.length) {
          setMonths(withDefaultsIfEmpty(null));
          setUsingBuiltInDraft(true);
        } else {
          setMonths(doc.months);
          setUsingBuiltInDraft(false);
        }
        setSavedMeta({ at: doc.updatedAt, by: doc.updatedByName });
      } else {
        const doc = await fetchFeatureUpdates();
        setMonths(doc.months);
        setUsingBuiltInDraft(false);
        setSavedMeta({ at: doc.updatedAt, by: doc.updatedByName });
      }
    } catch (err) {
      console.warn(err);
      if (isAdmin) {
        setMonths(withDefaultsIfEmpty(null));
        setUsingBuiltInDraft(true);
      } else {
        setMonths([]);
      }
      setError(err instanceof Error ? err.message : 'Could not load updates');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayMonths = editing && draft ? draft : months;

  const beginEdit = () => {
    setDraft(structuredClone(months.length ? months : withDefaultsIfEmpty(null)));
    setEditing(true);
    setError('');
  };

  const cancelEdit = () => {
    setDraft(null);
    setEditing(false);
    setError('');
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const cleaned = draft.map((month) => ({
        ...month,
        weeks: month.weeks.map((week) => ({
          ...week,
          items: week.items
            .map((entry) => ({
              ...entry,
              title: entry.title.trim(),
              detail: entry.detail?.trim() || undefined,
              forWho: entry.forWho?.trim() || undefined,
              category: entry.category || 'Feature',
              approved: entry.approved === true,
            }))
            .filter((entry) => entry.title),
        })),
      }));
      const saved = await saveFeatureUpdates(cleaned);
      setMonths(saved.months.length ? saved.months : cleaned);
      setUsingBuiltInDraft(false);
      setSavedMeta({ at: saved.updatedAt, by: saved.updatedByName });
      setDraft(null);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-900">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-10">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-sm text-slate-400 hover:text-slate-200 mb-3"
            >
              ← Event List
            </button>
            <h1 className="text-3xl font-bold text-white tracking-tight">Feature Updates</h1>
            <p className="mt-2 text-base text-slate-400 max-w-xl leading-relaxed">
              {isAdmin
                ? 'Draft from git — check Approve on each item, then Save. Only approved items are public.'
                : 'Approved updates by month. Open a month, then a week.'}
            </p>
            {isAdmin && usingBuiltInDraft ? (
              <p className="mt-2 text-xs text-amber-400/90">
                Built-in draft (not saved yet). Nothing is public until you Approve items and Save.
              </p>
            ) : null}
            {savedMeta.at ? (
              <p className="mt-2 text-xs text-slate-500">
                Last saved
                {savedMeta.by ? ` by ${savedMeta.by}` : ''}{' '}
                {new Date(savedMeta.at).toLocaleString()}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && !editing ? (
              <button
                type="button"
                onClick={beginEdit}
                className="rounded-lg border border-amber-600/70 bg-amber-950/50 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-900/60"
              >
                Edit copy
              </button>
            ) : null}
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="rounded-lg border border-sky-500 bg-sky-700/80 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-slate-400">Loading…</p>
        ) : !displayMonths.length ? (
          <p className="text-slate-400">
            No approved updates yet. Admins can draft and approve items from Edit copy.
          </p>
        ) : (
          <div className="space-y-4">
            {displayMonths.map((month) => (
              <MonthSection
                key={month.id}
                month={month}
                open={openMonthId === month.id}
                onToggle={() =>
                  setOpenMonthId((prev) => (prev === month.id ? '' : month.id))
                }
                editing={editing}
                isAdmin={isAdmin}
                onChangeMonth={(next) => {
                  if (!draft) return;
                  setDraft(draft.map((m) => (m.id === next.id ? next : m)));
                }}
                onRemoveMonth={() => {
                  if (!draft) return;
                  setDraft(draft.filter((m) => m.id !== month.id));
                }}
              />
            ))}

            {editing ? (
              <button
                type="button"
                onClick={() => {
                  if (!draft) return;
                  const month = newFeatureMonth('New month');
                  setDraft([...draft, month]);
                  setOpenMonthId(month.id);
                }}
                className="w-full rounded-2xl border border-dashed border-slate-500 px-4 py-4 text-sm text-slate-300 hover:border-sky-500 hover:text-sky-200"
              >
                + Add month
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default FeatureUpdatesPage;
