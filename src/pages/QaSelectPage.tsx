import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import QaModToolHeader from '../components/QaModToolHeader';
import {
  activateWebQaQuestion,
  completeWebQaQuestion,
  fetchWebQaQuestions,
  patchWebQaQuestion,
  type WebQaQuestion,
} from '../lib/webQa';

function isQueued(q: WebQaQuestion): boolean {
  return q.is_queued === true;
}

function sortQueued(list: WebQaQuestion[]): WebQaQuestion[] {
  return [...list].sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.created_at.localeCompare(b.created_at)
  );
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function QaSelectPage() {
  const { user } = useAuth();
  const location = useLocation();
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const loadSeq = React.useRef(0);

  const load = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    const seq = ++loadSeq.current;
    try {
      setError(null);
      const rows = await fetchWebQaQuestions(eventId, 'all');
      if (seq !== loadSeq.current) return;
      setQuestions(rows);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, [load]);

  const isActiveQ = (q: WebQaQuestion) => q.is_active === true;

  const active = useMemo(() => questions.find((q) => isActiveQ(q)) || null, [questions]);

  const queued = useMemo(
    () =>
      sortQueued(
        questions.filter(
          (q) => isQueued(q) && !isActiveQ(q) && q.status !== 'rejected'
        )
      ),
    [questions]
  );

  const approvedPool = useMemo(
    () =>
      questions.filter(
        (q) => q.status === 'approved' && !isQueued(q) && !isActiveQ(q)
      ),
    [questions]
  );

  const applyLocal = (updated: WebQaQuestion) => {
    setQuestions((prev) => {
      let next = prev.map((q) => (q.id === updated.id ? { ...q, ...updated } : q));
      if (isActiveQ(updated)) {
        next = next.map((q) =>
          q.id !== updated.id && isActiveQ(q)
            ? { ...q, is_active: false }
            : q
        );
      }
      return next;
    });
  };

  const sendToQueue = async (id: string) => {
    setBusyId(id);
    try {
      applyLocal(
        await patchWebQaQuestion(id, {
          is_queued: true,
          moderated_by: moderator,
        })
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Queue failed');
    } finally {
      setBusyId(null);
    }
  };

  const skipReject = async (id: string) => {
    setBusyId(id);
    try {
      applyLocal(
        await patchWebQaQuestion(id, {
          status: 'rejected',
          is_queued: false,
          moderated_by: moderator,
        })
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Reject failed');
    } finally {
      setBusyId(null);
    }
  };

  const unqueueOne = async (id: string) => {
    setBusyId(id);
    try {
      applyLocal(
        await patchWebQaQuestion(id, { is_queued: false, moderated_by: moderator })
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Unqueue failed');
    } finally {
      setBusyId(null);
    }
  };

  const makeActive = async (id: string) => {
    if (active && active.id !== id) {
      alert('Mark the current ACTIVE question Done before activating another.');
      return;
    }
    setBusyId(id);
    // Bump seq so an in-flight poll cannot overwrite the Active move.
    loadSeq.current += 1;
    try {
      const updated = await activateWebQaQuestion(id, moderator);
      applyLocal({
        ...updated,
        is_active: true,
        is_queued: false,
        status: updated.status === 'pending' ? 'approved' : updated.status,
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not make active');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const markDone = async (id: string) => {
    setBusyId(id);
    try {
      applyLocal(await completeWebQaQuestion(id, moderator));
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not mark done');
    } finally {
      setBusyId(null);
    }
  };

  if (!eventId) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <p className="text-slate-300">Open Select from Active Q&A / Management.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      <QaModToolHeader
        kind="select"
        eventId={eventId}
        eventName={eventName}
        qs={qs}
        meta={`${active ? '1 active · ' : ''}${queued.length} queued · ${approvedPool.length} approved`}
        onRefresh={() => void load()}
      />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-5">
        {loading && questions.length === 0 ? (
          <p className="text-slate-400">Loading…</p>
        ) : error ? (
          <div className="rounded-lg border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-rose-100">
            {error}
          </div>
        ) : null}

        <p className="text-xs text-slate-500 leading-relaxed">
          Flow: <span className="text-slate-300">Approved → Queue → Active → Done</span>. Only one
          Active at a time; mark Done before activating the next.
        </p>

        <section
          className={`rounded-xl border overflow-hidden ${
            active
              ? 'border-emerald-600/50 bg-emerald-950/25'
              : 'border-dashed border-slate-700 bg-slate-900/40'
          }`}
        >
          <div className="px-3 py-2 border-b border-slate-800/80">
            <p className="text-sm font-semibold text-emerald-100">Active</p>
          </div>
          {active ? (
            <div className="px-4 py-4 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-base sm:text-lg text-white leading-snug whitespace-pre-wrap break-words">
                  {active.body}
                </p>
                <p className="text-xs text-slate-400 mt-1.5">
                  {active.author_name || 'Anonymous'}
                  <span className="mx-1.5">·</span>
                  {formatWhen(active.created_at)}
                </p>
              </div>
              <button
                type="button"
                disabled={busyId === active.id}
                onClick={() => void markDone(active.id)}
                className="shrink-0 px-4 min-h-[3rem] rounded-xl bg-emerald-700 hover:bg-emerald-600 font-semibold disabled:opacity-50"
              >
                Done
              </button>
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              None yet — Make Active from the queue below.
            </p>
          )}
        </section>

        {/* Waiting queue */}
        <section className="rounded-xl border border-fuchsia-700/40 bg-fuchsia-950/20 overflow-hidden">
          <div className="px-3 py-2 border-b border-fuchsia-800/40 flex items-center justify-between">
            <p className="text-sm font-semibold text-fuchsia-100">Queue (waiting)</p>
            <span className="text-xs tabular-nums text-fuchsia-200/70">{queued.length}</span>
          </div>
          {queued.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              Empty — queue approved questions below.
            </p>
          ) : (
            <ol className="divide-y divide-fuchsia-900/40 max-h-64 overflow-y-auto">
              {queued.map((q, i) => (
                <li key={q.id} className="px-3 py-2.5 flex gap-3 items-center">
                  <span className="shrink-0 w-8 h-8 rounded-lg bg-fuchsia-700 text-white text-sm font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white leading-snug line-clamp-2">{q.body}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{q.author_name || 'Anonymous'}</p>
                  </div>
                  <div className="shrink-0 flex flex-col gap-1.5 w-[7.5rem]">
                    <button
                      type="button"
                      disabled={busyId === q.id || !!active}
                      onClick={() => void makeActive(q.id)}
                      className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40"
                      title={
                        active
                          ? 'Mark current Active Done first'
                          : 'Make this the active question'
                      }
                    >
                      Make Active
                    </button>
                    <button
                      type="button"
                      disabled={busyId === q.id}
                      onClick={() => void unqueueOne(q.id)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg text-slate-400 hover:text-rose-300 border border-slate-700"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div>
          <p className="text-sm font-semibold text-slate-200 mb-3">
            Approved
            <span className="ml-2 font-normal text-slate-500 text-xs">
              Queue or skip / reject
            </span>
          </p>

          {approvedPool.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 px-6 py-12 text-center text-slate-500 text-sm">
              No approved questions waiting.
            </div>
          ) : (
            <ul className="space-y-3">
              {approvedPool.map((q) => (
                <li
                  key={q.id}
                  className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-4 space-y-3"
                >
                  <p className="text-base text-white leading-snug whitespace-pre-wrap break-words">
                    {q.body}
                  </p>
                  <p className="text-xs text-slate-500">
                    {q.author_name || 'Anonymous'}
                    <span className="mx-1.5">·</span>
                    {formatWhen(q.created_at)}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={busyId === q.id}
                      onClick={() => void sendToQueue(q.id)}
                      className="min-h-[3.25rem] rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 font-semibold text-base disabled:opacity-50"
                    >
                      Queue
                    </button>
                    <button
                      type="button"
                      disabled={busyId === q.id}
                      onClick={() => void skipReject(q.id)}
                      className="min-h-[3.25rem] rounded-xl border border-slate-600 bg-slate-900 hover:bg-slate-800 font-semibold text-base text-slate-200 disabled:opacity-50"
                    >
                      Skip / Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
