import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import QaModToolHeader from '../components/QaModToolHeader';
import {
  activateWebQaQuestion,
  completeWebQaQuestion,
  fetchWebQaQuestions,
  reorderWebQaApproved,
  type WebQaQuestion,
} from '../lib/webQa';

function sortApproved(list: WebQaQuestion[]): WebQaQuestion[] {
  return [...list].sort(
    (a, b) =>
      (a.sort_order || 0) - (b.sort_order || 0) ||
      a.created_at.localeCompare(b.created_at)
  );
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function QaReadPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const eventId = params.get('eventId') || '';
  const eventName = params.get('eventName') || 'Event';
  const moderator = user?.full_name || user?.email || undefined;

  const qs = useMemo(
    () =>
      `eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(eventName)}`,
    [eventId, eventName]
  );

  const [questions, setQuestions] = useState<WebQaQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    try {
      setError(null);
      setQuestions(await fetchWebQaQuestions(eventId, 'all'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(id);
  }, [load]);

  const active = useMemo(
    () => questions.find((q) => q.is_active === true) || null,
    [questions]
  );

  const approved = useMemo(
    () =>
      sortApproved(
        questions.filter(
          (q) => q.status === 'approved' && q.is_active !== true && q.is_overflow !== true
        )
      ),
    [questions]
  );

  const current = approved[0] || null;

  const markDone = async () => {
    if (!active || busy) return;
    setBusy(true);
    try {
      await completeWebQaQuestion(active.id, moderator);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not mark done');
    } finally {
      setBusy(false);
    }
  };

  const makeActive = async () => {
    if (!current || active || busy) return;
    setBusy(true);
    try {
      await activateWebQaQuestion(current.id, moderator);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not make active');
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (!current || approved.length < 2 || busy || active) return;
    const ids = approved.map((q) => q.id);
    const next = [...ids.slice(1), ids[0]];
    setBusy(true);
    try {
      setQuestions(await reorderWebQaApproved(eventId, next, moderator));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not skip');
    } finally {
      setBusy(false);
    }
  };

  const moveApproved = async (id: string, direction: -1 | 1) => {
    const ids = approved.map((q) => q.id);
    const idx = ids.indexOf(id);
    const swap = idx + direction;
    if (idx < 0 || swap < 0 || swap >= ids.length || busy) return;
    const next = [...ids];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setBusy(true);
    try {
      setQuestions(await reorderWebQaApproved(eventId, next, moderator));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not reorder');
    } finally {
      setBusy(false);
    }
  };

  if (!eventId) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <p className="text-slate-300">Open Reader from Active Q&A / Management.</p>
      </div>
    );
  }

  const orderPanel = (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close order panel"
        onClick={() => setOrderOpen(false)}
      />
      <aside className="relative z-10 w-full max-w-md h-full bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col">
        <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">Approved order</p>
            <p className="text-[11px] text-slate-500">{approved.length} waiting</p>
          </div>
          <button
            type="button"
            onClick={() => setOrderOpen(false)}
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {approved.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-10">No approved questions to order.</p>
          ) : (
            <ul className="space-y-2">
              {approved.map((q, i) => (
                <li
                  key={q.id}
                  className={`rounded-xl border px-3 py-2.5 flex gap-2 items-center ${
                    i === 0
                      ? 'border-sky-700/50 bg-sky-950/30'
                      : 'border-slate-700 bg-slate-950/50'
                  }`}
                >
                  <span className="shrink-0 w-7 h-7 rounded-lg bg-slate-800 text-slate-200 text-xs font-bold flex items-center justify-center tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white leading-snug line-clamp-2">{q.body}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {q.author_name || 'Anonymous'}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col gap-1">
                    <button
                      type="button"
                      disabled={busy || i === 0}
                      onClick={() => void moveApproved(q.id, -1)}
                      className="w-9 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-sm"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={busy || i === approved.length - 1}
                      onClick={() => void moveApproved(q.id, 1)}
                      className="w-9 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-sm"
                    >
                      ↓
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <QaModToolHeader
        kind="read"
        eventId={eventId}
        eventName={eventName}
        qs={qs}
        meta={
          active
            ? `1 active · ${approved.length} approved`
            : `${approved.length} approved`
        }
        onRefresh={() => void load()}
      />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-5">
        {loading && !active && !current ? (
          <p className="text-slate-400">Loading…</p>
        ) : error ? (
          <div className="rounded-lg border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500 leading-relaxed">
            Approved → Make Active or Skip. Set order anytime.
          </p>
          <button
            type="button"
            onClick={() => setOrderOpen(true)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600"
          >
            Set order ({approved.length})
          </button>
        </div>

        {active ? (
          <article className="rounded-xl border border-emerald-600/40 bg-gradient-to-b from-emerald-950/40 to-slate-900 px-5 py-6 sm:px-6 min-h-[28vh] flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-300/80 font-semibold mb-3">
                Active
              </p>
              <p className="text-2xl sm:text-3xl font-semibold text-white leading-snug whitespace-pre-wrap break-words">
                {active.body}
              </p>
              <p className="mt-5 text-sm text-slate-400">
                {active.author_name || 'Anonymous'}
                <span className="mx-2 text-slate-600">·</span>
                {formatWhen(active.created_at)}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void markDone()}
              className="shrink-0 px-5 min-h-[4.5rem] rounded-xl bg-emerald-700 hover:bg-emerald-600 font-semibold text-base disabled:opacity-50"
            >
              Done
            </button>
          </article>
        ) : !current ? (
          <div className="rounded-xl border border-dashed border-slate-700 px-6 py-14 text-center space-y-3">
            <p className="text-xl text-slate-400">No approved questions</p>
            <p className="text-sm text-slate-500">
              Approve questions in Active Q&A first, then come back here.
            </p>
            <button
              type="button"
              onClick={() => navigate(`/qa-mod/active?${qs}`)}
              className="px-4 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 font-semibold text-sm"
            >
              Open Active Q&A
            </button>
          </div>
        ) : (
          <>
            <article className="rounded-xl border border-sky-600/40 bg-gradient-to-b from-sky-950/50 to-slate-900 px-5 py-6 sm:px-7 sm:py-7 min-h-[48vh] flex flex-col justify-start">
              <p className="text-2xl sm:text-3xl font-semibold text-white leading-snug whitespace-pre-wrap break-words">
                {current.body}
              </p>
              <p className="mt-auto pt-6 text-sm text-slate-400">
                {current.author_name || 'Anonymous'}
                <span className="mx-2 text-slate-600">·</span>
                {formatWhen(current.created_at)}
              </p>
            </article>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void makeActive()}
                className="min-h-[3.25rem] rounded-xl bg-emerald-700 hover:bg-emerald-600 font-semibold text-base disabled:opacity-50"
              >
                Make Active
                <span className="block text-[11px] font-normal opacity-80">
                  Puts this question on stage
                </span>
              </button>
              <button
                type="button"
                disabled={busy || approved.length < 2}
                onClick={() => void skip()}
                className="min-h-[3.25rem] rounded-xl border border-slate-600 bg-slate-900 hover:bg-slate-800 font-semibold text-base disabled:opacity-40"
              >
                Skip
                <span className="block text-[11px] font-normal text-slate-400">
                  Show next approved
                </span>
              </button>
            </div>
          </>
        )}
      </main>

      {orderOpen ? orderPanel : null}
    </div>
  );
}
