import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  assigneeDisplayName,
  fetchContentReviewAssignees,
  saveContentReviewAssignees,
  type ContentReviewAssigneeCandidate,
  type ContentReviewAssigneesPayload,
} from '../lib/contentReviewAssignees';

type ContentReviewAssigneesModalProps = {
  open: boolean;
  eventId: string;
  eventName: string;
  onClose: () => void;
  onSaved?: (assignees: ContentReviewAssigneesPayload['assignees']) => void;
};

function toggleId(list: string[], id: string, max: number): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  if (list.length >= max) return list;
  return [...list, id];
}

function CandidateList({
  title,
  hint,
  candidates,
  selected,
  max,
  onToggle,
  accentClass,
}: {
  title: string;
  hint: string;
  candidates: ContentReviewAssigneeCandidate[];
  selected: string[];
  max: number;
  onToggle: (id: string) => void;
  accentClass: string;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => {
      const name = assigneeDisplayName(c).toLowerCase();
      return name.includes(q) || (c.email || '').toLowerCase().includes(q);
    });
  }, [candidates, search]);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        <p className="text-[11px] text-slate-400">{hint}</p>
        <p className="mt-1 text-[10px] text-slate-500">
          {selected.length}/{max} selected
        </p>
      </div>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or email…"
        className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-orange-400"
      />
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/60 p-1.5">
        {filtered.length === 0 ? (
          <li className="px-2 py-3 text-center text-xs text-slate-500">No matching users.</li>
        ) : (
          filtered.map((candidate) => {
            const checked = selected.includes(candidate.id);
            const disabled = !checked && selected.length >= max;
            return (
              <li key={candidate.id}>
                <label
                  className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 ${
                    checked
                      ? `${accentClass} border-current/40`
                      : disabled
                        ? 'border-transparent opacity-45'
                        : 'border-transparent hover:bg-slate-800/80'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onToggle(candidate.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-100">
                      {assigneeDisplayName(candidate)}
                    </span>
                    <span className="block truncate text-[10px] text-slate-400">{candidate.email}</span>
                  </span>
                </label>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

const ContentReviewAssigneesModal: React.FC<ContentReviewAssigneesModalProps> = ({
  open,
  eventId,
  eventName,
  onClose,
  onSaved,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ContentReviewAssigneesPayload | null>(null);
  const [creativeIds, setCreativeIds] = useState<string[]>([]);
  const [productionIds, setProductionIds] = useState<string[]>([]);

  const maxPerRole = payload?.max_per_role ?? 2;

  useEffect(() => {
    if (!open || !eventId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const { data, error: loadError } = await fetchContentReviewAssignees(eventId);
      if (cancelled) return;
      if (loadError || !data) {
        setError(loadError || 'Failed to load assignees');
        setPayload(null);
      } else {
        setPayload(data);
        setCreativeIds(data.assignees.creative.map((a) => a.access_id));
        setProductionIds(data.assignees.production.map((a) => a.access_id));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, eventId]);

  const toggleCreative = useCallback(
    (id: string) => setCreativeIds((prev) => toggleId(prev, id, maxPerRole)),
    [maxPerRole]
  );
  const toggleProduction = useCallback(
    (id: string) => setProductionIds((prev) => toggleId(prev, id, maxPerRole)),
    [maxPerRole]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    const { data, error: saveError } = await saveContentReviewAssignees(eventId, {
      creative: creativeIds,
      production: productionIds,
    });
    setSaving(false);
    if (saveError || !data) {
      setError(saveError || 'Failed to save');
      return;
    }
    onSaved?.(data.assignees);
    onClose();
  }, [creativeIds, eventId, onClose, onSaved, productionIds]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-600 bg-slate-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cr-assignees-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Content review</p>
            <h2 id="cr-assignees-title" className="text-lg font-bold text-white">
              Review team
            </h2>
            <p className="text-xs text-slate-400">{eventName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 p-2 text-slate-300 hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-slate-400">Loading assignees…</p>
          ) : error ? (
            <p className="text-sm text-rose-300">{error}</p>
          ) : payload?.can_manage ? (
            <>
              <p className="mb-4 text-xs leading-relaxed text-slate-400">
                Assign up to {maxPerRole} Creative users and {maxPerRole} Production reviewers. Assigned users
                receive email when they are added and when there are new comments or review updates on this event.
              </p>
              <div className="grid min-h-[320px] gap-4 md:grid-cols-2">
                <CandidateList
                  title="Creative reviewers"
                  hint="Creative-role users who respond to feedback."
                  candidates={payload.candidates.creative}
                  selected={creativeIds}
                  max={maxPerRole}
                  onToggle={toggleCreative}
                  accentClass="bg-violet-950/50 text-violet-200"
                />
                <CandidateList
                  title="Production reviewers"
                  hint="Production team who leave review notes and approve cues."
                  candidates={payload.candidates.production}
                  selected={productionIds}
                  max={maxPerRole}
                  onToggle={toggleProduction}
                  accentClass="bg-amber-950/40 text-amber-100"
                />
              </div>
            </>
          ) : (
            <div className="space-y-3 text-sm text-slate-300">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-300">Creative</p>
                {payload?.assignees.creative.length ? (
                  <ul className="mt-1 space-y-1">
                    {payload.assignees.creative.map((a) => (
                      <li key={a.id} className="text-xs text-slate-200">
                        {assigneeDisplayName(a)} <span className="text-slate-500">({a.email})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">None assigned</p>
                )}
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">Production</p>
                {payload?.assignees.production.length ? (
                  <ul className="mt-1 space-y-1">
                    {payload.assignees.production.map((a) => (
                      <li key={a.id} className="text-xs text-slate-200">
                        {assigneeDisplayName(a)} <span className="text-slate-500">({a.email})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">None assigned</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-700 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            {payload?.can_manage ? 'Cancel' : 'Close'}
          </button>
          {payload?.can_manage ? (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || loading}
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save & notify'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ContentReviewAssigneesModal;
