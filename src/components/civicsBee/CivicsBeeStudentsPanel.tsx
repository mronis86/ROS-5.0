import React, { useCallback, useMemo, useState } from 'react';
import {
  CIVICS_BEE_FILTER_LABELS,
  CIVICS_BEE_TIER_OPTIONS,
  CivicsBeeEntry,
  CivicsBeeFilter,
  CivicsBeeRoster,
  CivicsBeeTier,
  countCivicsBeeByFilter,
  filterCivicsBeeEntries,
} from '../../lib/civicsBee';

type CivicsBeeStudentsPanelProps = {
  roster: CivicsBeeRoster;
  saving?: boolean;
  readOnly?: boolean;
  onChange: (next: CivicsBeeRoster) => void;
  onSave: () => void;
};

const FILTERS: CivicsBeeFilter[] = ['all', 'participating', 'top25', 'top10', 'top5'];

const CivicsBeeStudentsPanel: React.FC<CivicsBeeStudentsPanelProps> = ({
  roster,
  saving = false,
  readOnly = false,
  onChange,
  onSave,
}) => {
  const [filter, setFilter] = useState<CivicsBeeFilter>('all');
  const [search, setSearch] = useState('');

  const updateEntry = useCallback(
    (code: string, patch: Partial<CivicsBeeEntry>) => {
      if (readOnly) return;
      const entries = roster.entries.map((e) => {
        if (e.code !== code) return e;
        const next = { ...e, ...patch };
        if (patch.participating === false) {
          next.tier = null;
        }
        if (patch.tier && !next.participating) {
          next.participating = true;
        }
        return next;
      });
      onChange({ ...roster, entries });
    },
    [onChange, readOnly, roster]
  );

  const visible = useMemo(() => {
    const filtered = filterCivicsBeeEntries(roster.entries, filter);
    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.code.toLowerCase().includes(q) ||
        e.studentName.toLowerCase().includes(q)
    );
  }, [filter, roster.entries, search]);

  const setAllParticipating = (value: boolean) => {
    if (readOnly) return;
    onChange({
      ...roster,
      entries: roster.entries.map((e) => ({
        ...e,
        participating: value,
        tier: value ? e.tier : null,
      })),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Civics Bee Students</h2>
          <p className="text-sm text-slate-400">
            Assign a student per state/territory, mark who is playing, and advance Top 25 / 10 / 5.
          </p>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save roster'}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count = countCivicsBeeByFilter(roster.entries, f);
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? 'border-sky-500 bg-sky-950/60 text-sky-100'
                  : 'border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {CIVICS_BEE_FILTER_LABELS[f]} ({count})
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search state or student…"
          className="w-full max-w-md rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
        {!readOnly && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAllParticipating(true)}
              className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            >
              Mark all participating
            </button>
            <button
              type="button"
              onClick={() => setAllParticipating(false)}
              className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            >
              Clear participating
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-700">
        <div className="max-h-[min(70vh,720px)] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-300">
              <tr>
                <th className="px-3 py-2 font-semibold">Code</th>
                <th className="px-3 py-2 font-semibold">State / Territory</th>
                <th className="px-3 py-2 font-semibold">Student</th>
                <th className="px-3 py-2 font-semibold text-center">In game</th>
                <th className="px-3 py-2 font-semibold">Advancement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900/80">
              {visible.map((entry) => (
                <tr key={entry.code} className={!entry.participating ? 'opacity-70' : undefined}>
                  <td className="px-3 py-2 font-mono text-slate-400">{entry.code}</td>
                  <td className="px-3 py-2 text-slate-100">{entry.name}</td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={entry.studentName}
                      disabled={readOnly}
                      onChange={(e) => updateEntry(entry.code, { studentName: e.target.value })}
                      placeholder="Student name"
                      className="w-full min-w-[10rem] rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white placeholder:text-slate-600 disabled:opacity-60"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={entry.participating}
                      disabled={readOnly}
                      onChange={(e) => updateEntry(entry.code, { participating: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-500"
                      aria-label={`${entry.name} participating`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={entry.tier || ''}
                      disabled={readOnly || !entry.participating}
                      onChange={(e) => {
                        const v = e.target.value as CivicsBeeTier | '';
                        updateEntry(entry.code, { tier: v ? v : null });
                      }}
                      className="rounded border border-slate-600 bg-slate-950 px-2 py-1.5 text-white disabled:opacity-50"
                    >
                      {CIVICS_BEE_TIER_OPTIONS.map((opt) => (
                        <option key={opt.label} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                    No rows match this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CivicsBeeStudentsPanel;
