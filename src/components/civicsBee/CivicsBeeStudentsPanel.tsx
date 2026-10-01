import React, { useCallback, useMemo, useState } from 'react';
import {
  applyCivicsBeePeoplesChoice,
  applyCivicsBeePlace,
  buildCivicsBeeGraphicsCsv,
  CIVICS_BEE_AWARD_CSV_OPTIONS,
  CIVICS_BEE_CSV_FILTER_LABELS,
  CIVICS_BEE_FILTER_LABELS,
  CIVICS_BEE_PLACE_OPTIONS,
  CIVICS_BEE_TIER_OPTIONS,
  CivicsBeeCsvFilter,
  CivicsBeeEntry,
  CivicsBeeFilter,
  CivicsBeeImportResult,
  CivicsBeePlace,
  CivicsBeeRoster,
  CivicsBeeTier,
  countCivicsBeeByFilter,
  filterCivicsBeeEntries,
} from '../../lib/civicsBee';
import CivicsBeeExcelImportModal from './CivicsBeeExcelImportModal';

type CivicsBeeStudentsPanelProps = {
  roster: CivicsBeeRoster;
  eventId?: string;
  saving?: boolean;
  readOnly?: boolean;
  onChange: (next: CivicsBeeRoster) => void;
  onSave: () => void;
};

const FILTERS: CivicsBeeFilter[] = ['all', 'participating', 'top25', 'top10', 'top5'];

const GRAPHICS_API_BASE =
  ((import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
    'https://ros-50-production.up.railway.app').replace(/\/$/, '');

const CivicsBeeStudentsPanel: React.FC<CivicsBeeStudentsPanelProps> = ({
  roster,
  eventId,
  saving = false,
  readOnly = false,
  onChange,
  onSave,
}) => {
  const [filter, setFilter] = useState<CivicsBeeFilter>('all');
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [graphicsNotice, setGraphicsNotice] = useState<string | null>(null);

  const graphicsFilter: CivicsBeeCsvFilter = filter === 'all' ? 'participating' : filter;

  const graphicsCsvUrlFor = useCallback(
    (csvFilter: CivicsBeeCsvFilter) => {
      if (!eventId) return '';
      return `${GRAPHICS_API_BASE}/api/civics-bee.csv?eventId=${encodeURIComponent(eventId)}&filter=${encodeURIComponent(csvFilter)}`;
    },
    [eventId]
  );

  const graphicsCsvUrl = useMemo(
    () => graphicsCsvUrlFor(graphicsFilter),
    [graphicsCsvUrlFor, graphicsFilter]
  );

  const copyCsvUrl = async (csvFilter: CivicsBeeCsvFilter, label?: string) => {
    const url = graphicsCsvUrlFor(csvFilter);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setGraphicsNotice(
        `${label || CIVICS_BEE_CSV_FILTER_LABELS[csvFilter] || 'CSV'} live URL copied.`
      );
    } catch {
      setGraphicsNotice('Could not copy URL — select it manually.');
    }
    setTimeout(() => setGraphicsNotice(null), 3000);
  };

  const downloadCsv = (csvFilter: CivicsBeeCsvFilter, fileSlug?: string) => {
    const csv = buildCivicsBeeGraphicsCsv(roster.entries, csvFilter);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `civics-bee-${fileSlug || csvFilter}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updateEntry = useCallback(
    (code: string, patch: Partial<CivicsBeeEntry>) => {
      if (readOnly) return;
      const entries = roster.entries.map((e) => {
        if (e.code !== code) return e;
        const next = { ...e, ...patch };
        if (patch.participating === false) {
          next.tier = null;
          next.place = null;
          next.peoplesChoice = false;
        }
        if (patch.tier && !next.participating) {
          next.participating = true;
        }
        if (next.tier !== 'top5') {
          next.place = null;
          next.peoplesChoice = false;
        }
        return next;
      });
      onChange({ ...roster, entries });
    },
    [onChange, readOnly, roster]
  );

  const togglePlace = (code: string, place: CivicsBeePlace) => {
    if (readOnly) return;
    onChange(applyCivicsBeePlace(roster, code, place));
  };

  const togglePeoplesChoice = (code: string) => {
    if (readOnly) return;
    const entry = roster.entries.find((e) => e.code === code);
    if (!entry) return;
    onChange(applyCivicsBeePeoplesChoice(roster, code, !entry.peoplesChoice));
  };

  const showAwards = filter === 'top5';

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

  const handleImportApply = (result: CivicsBeeImportResult) => {
    if (readOnly) return;
    onChange(result.roster);
    const parts = [`Applied ${result.applied} student${result.applied === 1 ? '' : 's'} (In game on).`];
    if (result.unmatched.length) {
      parts.push(`${result.unmatched.length} unmatched state value${result.unmatched.length === 1 ? '' : 's'}.`);
    }
    setImportNotice(parts.join(' '));
    setTimeout(() => setImportNotice(null), 5000);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Civics Bee Students</h2>
          <p className="text-sm text-slate-400">
            Assign a student per state/territory, mark who is playing, advance Top 25 / 10 / 5, and
            on the Top 5 tab set 3rd / 2nd / 1st and People&apos;s Choice.
          </p>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="rounded-md border border-sky-600/70 bg-sky-950/40 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-900/50"
            >
              Import Excel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save roster'}
            </button>
          </div>
        )}
      </div>

      {importNotice && (
        <div className="rounded-md border border-emerald-700/40 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">
          {importNotice}
        </div>
      )}

      <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Graphics CSV</h3>
            <p className="text-xs text-slate-400">
              Columns: First Name, Last Initial, State — filtered to{' '}
              {CIVICS_BEE_CSV_FILTER_LABELS[graphicsFilter] || graphicsFilter}
              {filter === 'all' ? ' (All view uses Participating for the feed)' : ''}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => downloadCsv(graphicsFilter)}
              className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              Download CSV
            </button>
            {graphicsCsvUrl ? (
              <button
                type="button"
                onClick={() => void copyCsvUrl(graphicsFilter)}
                className="rounded-md border border-violet-600/70 bg-violet-950/40 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-900/50"
              >
                Copy live URL
              </button>
            ) : null}
          </div>
        </div>
        {graphicsCsvUrl ? (
          <code className="block break-all rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-300">
            {graphicsCsvUrl}
          </code>
        ) : (
          <p className="text-xs text-slate-500">Open this page with an eventId to get a live graphics URL.</p>
        )}
        {graphicsNotice && <p className="text-xs text-emerald-300">{graphicsNotice}</p>}
      </div>

      <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 px-4 py-3 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-amber-100">Award CSVs</h3>
          <p className="text-xs text-slate-400">
            1st / 2nd / 3rd / People&apos;s Choice — columns: First Name, Last Name, State. Save the
            roster after marking awards so live URLs stay current.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CIVICS_BEE_AWARD_CSV_OPTIONS.map((opt) => {
            const url = graphicsCsvUrlFor(opt.value);
            return (
              <div
                key={opt.value}
                className="rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 space-y-2"
              >
                <div className="text-xs font-semibold text-slate-100">{opt.label}</div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => downloadCsv(opt.value, opt.fileSlug)}
                    className="rounded border border-slate-600 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
                  >
                    Download
                  </button>
                  {url ? (
                    <button
                      type="button"
                      onClick={() => void copyCsvUrl(opt.value, opt.label)}
                      className="rounded border border-violet-600/70 bg-violet-950/40 px-2 py-1 text-[11px] font-semibold text-violet-100 hover:bg-violet-900/50"
                    >
                      Copy URL
                    </button>
                  ) : null}
                </div>
                {url ? (
                  <code className="block break-all text-[10px] text-slate-500">{url}</code>
                ) : null}
              </div>
            );
          })}
        </div>
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
                {showAwards ? (
                  <th className="px-3 py-2 font-semibold">Awards</th>
                ) : null}
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
                  {showAwards ? (
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {CIVICS_BEE_PLACE_OPTIONS.map((opt) => {
                          const active = entry.place === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              disabled={readOnly || entry.tier !== 'top5'}
                              onClick={() => togglePlace(entry.code, opt.value)}
                              className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-40 ${
                                active
                                  ? opt.value === '1st'
                                    ? 'border-amber-400 bg-amber-500/30 text-amber-100'
                                    : opt.value === '2nd'
                                      ? 'border-slate-300 bg-slate-400/30 text-slate-50'
                                      : 'border-orange-700 bg-orange-800/40 text-orange-100'
                                  : 'border-slate-600 bg-slate-950 text-slate-400 hover:bg-slate-800'
                              }`}
                              title={
                                active
                                  ? `Clear ${opt.label} Place`
                                  : `Mark ${opt.label} Place (only one student)`
                              }
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          disabled={readOnly || entry.tier !== 'top5'}
                          onClick={() => togglePeoplesChoice(entry.code)}
                          className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-40 ${
                            entry.peoplesChoice
                              ? 'border-fuchsia-400 bg-fuchsia-600/30 text-fuchsia-100'
                              : 'border-slate-600 bg-slate-950 text-slate-400 hover:bg-slate-800'
                          }`}
                          title={
                            entry.peoplesChoice
                              ? "Clear People's Choice"
                              : "Mark People's Choice (only one student)"
                          }
                        >
                          People&apos;s
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td
                    colSpan={showAwards ? 6 : 5}
                    className="px-3 py-8 text-center text-slate-400"
                  >
                    No rows match this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!readOnly && (
        <CivicsBeeExcelImportModal
          isOpen={importOpen}
          roster={roster}
          onClose={() => setImportOpen(false)}
          onApply={handleImportApply}
        />
      )}
    </div>
  );
};

export default CivicsBeeStudentsPanel;
