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

  /** Approved waiting to go Active — Reader works from this pool, not the Select queue. */
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
  const rest = approved.slice(1);

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

  /** Skip = send current approved to the back of Reader order. */
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

        <p className="text-xs text-slate-500 leading-relaxed">
          Works from <span className="text-slate-300">approved</span> questions. Make Active or
          Skip. Use ↑↓ below to set order.
        </p>

        {active ? (
          <>
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

            {approved.length > 0 ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
                  Next approved ({approved.length})
                </p>
                <ul className="space-y-1.5">
                  {approved.slice(0, 6).map((q, i) => (
                    <li
                      key={q.id}
                      className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm text-slate-400 flex gap-2 items-center"
                    >
                      <span className="text-slate-600 tabular-nums w-5 shrink-0">{i + 1}.</span>
                      <span className="line-clamp-1 text-slate-300 flex-1 min-w-0">{q.body}</span>
                      <div className="shrink-0 flex gap-1">
                        <button
                          type="button"
                          disabled={busy || i === 0}
                          onClick={() => void moveApproved(q.id, -1)}
                          className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-sm"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={busy || i >= approved.length - 1}
                          onClick={() => void moveApproved(q.id, 1)}
                          className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-sm"
                        >
                          ↓
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
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
            <div className="flex justify-between text-sm text-slate-400">
              <span>
                Next approved{' '}
                <span className="text-sky-300 font-semibold tabular-nums">
                  1 / {approved.length}
                </span>
              </span>
              <span>{Math.max(0, approved.length - 1)} after</span>
            </div>

            <article className="rounded-xl border border-sky-600/40 bg-gradient-to-b from-sky-950/50 to-slate-900 px-5 py-8 sm:px-6 min-h-[32vh] flex flex-col justify-center">
              <p className="text-[11px] uppercase tracking-[0.2em] text-sky-300/80 font-semibold mb-3">
                Next approved
              </p>
              <p className="text-2xl sm:text-3xl font-semibold text-white leading-snug whitespace-pre-wrap break-words">
                {current.body}
              </p>
              <p className="mt-5 text-sm text-slate-400">
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

            {rest.length > 0 ? (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
                  Order (↑↓)
                </p>
                <ul className="space-y-1.5">
                  {approved.map((q, i) => (
                    <li
                      key={q.id}
                      className={`rounded-lg border px-3 py-2 text-sm flex gap-2 items-center ${
                        i === 0
                          ? 'border-sky-700/50 bg-sky-950/30'
                          : 'border-slate-800 bg-slate-900/50'
                      }`}
                    >
                      <span className="text-slate-600 tabular-nums w-5 shrink-0">{i + 1}.</span>
                      <span
                        className={`line-clamp-1 flex-1 min-w-0 ${
                          i === 0 ? 'text-white' : 'text-slate-300'
                        }`}
                      >
                        {q.body}
                      </span>
                      <div className="shrink-0 flex gap-1">
                        <button
                          type="button"
                          disabled={busy || i === 0}
                          onClick={() => void moveApproved(q.id, -1)}
                          className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-sm"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={busy || i === approved.length - 1}
                          onClick={() => void moveApproved(q.id, 1)}
                          className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-sm"
                        >
                          ↓
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
