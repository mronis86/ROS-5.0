import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  buildCivicsBeeGraphicsSelection,
  CivicsBeeGraphicsSelection,
  CivicsBeeRoster,
  CivicsBeeTier,
  CIVICS_BEE_FILTER_LABELS,
  createDefaultCivicsBeeRoster,
  entryMeetsFilter,
  formatCivicsBeeShortDisplayName,
  parseCivicsBeeRoster,
} from '../lib/civicsBee';
import { DatabaseService } from '../services/database';

const TIERS: CivicsBeeTier[] = ['top25', 'top10', 'top5'];

function normalizeTierParam(raw: string | null): CivicsBeeTier {
  if (raw === 'top10' || raw === 'top5' || raw === 'top25') return raw;
  return 'top25';
}

const CivicsGraphicsSelectPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId') || '';
  const pathTier = location.pathname.match(/\/civics-graphics\/(top25|top10|top5)/)?.[1] || null;
  const tier = normalizeTierParam(searchParams.get('tier') || pathTier);

  const [eventName, setEventName] = useState('');
  const [roster, setRoster] = useState<CivicsBeeRoster>(() => createDefaultCivicsBeeRoster());
  const [selection, setSelection] = useState<CivicsBeeGraphicsSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId. Open from Extend Event Controls → Civics.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [cal, ext] = await Promise.all([
        DatabaseService.getCalendarEvent(eventId),
        DatabaseService.getExtendEventControls(eventId),
      ]);
      setEventName(cal?.name || searchParams.get('eventName') || 'Event');
      if (!ext.enabled) {
        setError('Extend Event Controls is not enabled for this event.');
      }
      const parsed = parseCivicsBeeRoster(ext.moduleData?.civicsBee);
      setRoster(parsed);
      setSelection(parsed.graphicsSelection ?? null);
    } catch (e) {
      console.error(e);
      setError('Failed to load Civics roster.');
    } finally {
      setLoading(false);
    }
  }, [eventId, searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  const buttons = useMemo(() => {
    return roster.entries
      .filter((e) => entryMeetsFilter(e, tier) && e.studentName.trim())
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [roster.entries, tier]);

  const setTier = (next: CivicsBeeTier) => {
    const qs = new URLSearchParams();
    if (eventId) qs.set('eventId', eventId);
    const name = searchParams.get('eventName');
    if (name) qs.set('eventName', name);
    qs.set('tier', next);
    navigate(`/civics-graphics/${next}?${qs.toString()}`, { replace: true });
  };

  const selectStudent = async (code: string) => {
    if (!eventId) return;
    const entry = roster.entries.find((e) => e.code === code);
    if (!entry) return;
    const next = buildCivicsBeeGraphicsSelection(entry, tier);
    setBusyCode(code);
    setStatus(null);
    const ok = await DatabaseService.setCivicsBeeSelection(eventId, next);
    setBusyCode(null);
    if (!ok) {
      setStatus('Could not set selection — try again.');
      return;
    }
    setSelection(next);
    setStatus(`On air: ${next.name} · ${next.state} (${CIVICS_BEE_FILTER_LABELS[tier]})`);
  };

  const clearSelection = async () => {
    if (!eventId) return;
    setBusyCode('__clear__');
    const ok = await DatabaseService.setCivicsBeeSelection(eventId, null);
    setBusyCode(null);
    if (!ok) {
      setStatus('Could not clear selection.');
      return;
    }
    setSelection(null);
    setStatus('Selection cleared.');
  };

  const extendUrl = `/extend-event-controls?eventId=${encodeURIComponent(eventId)}`;
  const bridgeZipHref = '/ros-civics-vmix-bridge.zip';

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-300">Loading Civics graphics…</div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-5">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <button
              type="button"
              onClick={() => navigate(extendUrl)}
              className="mb-2 text-xs text-slate-400 hover:text-slate-200"
            >
              ← Extend Event Controls
            </button>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Civics Graphics · {CIVICS_BEE_FILTER_LABELS[tier]}
            </h1>
            <p className="text-sm text-slate-400">
              {eventName}
              {selection
                ? ` · Selected: ${selection.name} (${selection.state})`
                : ' · Tap a student to select in vMix'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={bridgeZipHref}
              download="ros-civics-vmix-bridge.zip"
              className="rounded-lg border border-cyan-600/60 bg-cyan-950/50 px-3 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-900/50"
            >
              Download Civics vMix Bridge
            </a>
            <button
              type="button"
              onClick={() => void clearSelection()}
              disabled={busyCode === '__clear__' || !selection}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-40"
            >
              Clear selection
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-amber-700/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
            {error}
          </div>
        )}
        {status && (
          <div className="mb-4 rounded-lg border border-emerald-700/40 bg-emerald-950/30 px-4 py-2 text-sm text-emerald-100">
            {status}
          </div>
        )}

        <div className="mb-5 flex flex-wrap gap-2">
          {TIERS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${
                tier === t
                  ? 'bg-white text-slate-900'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {CIVICS_BEE_FILTER_LABELS[t]}
            </button>
          ))}
          <Link
            to={extendUrl}
            className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-700"
          >
            Roster editor
          </Link>
        </div>

        <p className="mb-3 text-xs text-slate-500">
          Separate from ROS cues. The Civics bridge on the vMix PC watches this selection and calls
          DataSourceSelectRow on the matching Top 25 / 10 / 5 Data Source.
        </p>

        {buttons.length === 0 ? (
          <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-10 text-center text-slate-400">
            No students in {CIVICS_BEE_FILTER_LABELS[tier]} yet. Mark tiers on the roster editor first.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {buttons.map((entry) => {
              const shortName = formatCivicsBeeShortDisplayName(entry.studentName);
              const active =
                selection?.code === entry.code &&
                selection?.filter === tier &&
                selection?.name === shortName;
              const busy = busyCode === entry.code;
              return (
                <button
                  key={entry.code}
                  type="button"
                  disabled={!!busyCode}
                  onClick={() => void selectStudent(entry.code)}
                  className={`flex min-h-[7.5rem] flex-col items-center justify-center rounded-2xl border-2 px-3 py-4 text-center shadow-lg transition ${
                    active
                      ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                      : 'border-slate-600 bg-slate-800 text-white hover:border-slate-400 hover:bg-slate-700'
                  } disabled:opacity-60`}
                >
                  <span className="text-lg font-bold leading-tight">{shortName || '—'}</span>
                  <span className={`mt-2 text-xs font-semibold uppercase tracking-wide ${active ? 'text-emerald-950/80' : 'text-slate-400'}`}>
                    {entry.code}
                  </span>
                  <span className={`mt-0.5 text-[11px] ${active ? 'text-emerald-950/70' : 'text-slate-500'}`}>
                    {entry.name}
                  </span>
                  {busy && <span className="mt-2 text-[10px] opacity-80">Sending…</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CivicsGraphicsSelectPage;
