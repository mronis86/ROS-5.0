import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  deleteWebQaQuestion,
  fetchWebQaQuestions,
  fetchWebQaSession,
  patchWebQaQuestion,
  reorderWebQaQueue,
  type WebQaQuestion,
  type WebQaSession,
  type WebQaStatus,
} from '../lib/webQa';

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function isQueued(q: WebQaQuestion): boolean {
  return q.is_queued === true;
}

type LaneId = 'inbox' | 'ready' | 'queue' | 'done';

export default function QaActiveModPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const eventId = params.get('eventId') || '';
  const eventName = params.get('eventName') || 'Event';
  const moderator = user?.full_name || user?.email || undefined;

  const [session, setSession] = useState<WebQaSession | null>(null);
  const [questions, setQuestions] = useState<WebQaQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const qs = useMemo(
    () =>
      `eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(eventName)}`,
    [eventId, eventName]
  );

  const load = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const [sess, list] = await Promise.all([
        fetchWebQaSession(eventId, { title: eventName !== 'Event' ? eventName : undefined }),
        fetchWebQaQuestions(eventId, 'all'),
      ]);
      setSession(sess);
      setQuestions(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Q&A');
    } finally {
      setLoading(false);
    }
  }, [eventId, eventName]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 4000);
    return () => window.clearInterval(id);
  }, [load]);

  const inbox = useMemo(
    () => questions.filter((q) => q.status === 'pending' && !isQueued(q)),
    [questions]
  );
  const ready = useMemo(
    () => questions.filter((q) => q.status === 'approved' && !isQueued(q)),
    [questions]
  );
  const queue = useMemo(
    () =>
      questions
        .filter((q) => isQueued(q) && q.status !== 'rejected')
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.created_at.localeCompare(b.created_at)),
    [questions]
  );
  const done = useMemo(
    () =>
      questions.filter(
        (q) => q.status === 'answered' || q.status === 'rejected' || q.status === 'archived'
      ),
    [questions]
  );

  const applyLocal = (updated: WebQaQuestion) => {
    setQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
  };

  const runPatch = async (
    id: string,
    patch: { status?: WebQaStatus; is_queued?: boolean }
  ) => {
    setBusyId(id);
    try {
      const updated = await patchWebQaQuestion(id, { ...patch, moderated_by: moderator });
      applyLocal(updated);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this question permanently?')) return;
    setBusyId(id);
    try {
      await deleteWebQaQuestion(id);
      setQuestions((prev) => prev.filter((q) => q.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  const moveInQueue = async (id: string, direction: -1 | 1) => {
    const ids = queue.map((q) => q.id);
    const idx = ids.indexOf(id);
    const swap = idx + direction;
    if (idx < 0 || swap < 0 || swap >= ids.length) return;
    const next = [...ids];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setBusyId(id);
    try {
      const list = await reorderWebQaQueue(eventId, next, moderator);
      setQuestions(list);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Reorder failed');
    } finally {
      setBusyId(null);
    }
  };

  if (!eventId) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <p className="text-slate-300">Open Active Q&A from the Web Q&A management page.</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600"
          >
            Back to events
          </button>
        </div>
      </div>
    );
  }

  const renderCard = (q: WebQaQuestion, lane: LaneId) => {
    const busy = busyId === q.id;
    return (
      <li
        key={q.id}
        className={`rounded-lg border px-3 py-2.5 space-y-2 ${
          lane === 'queue'
            ? 'border-fuchsia-600/50 bg-fuchsia-950/25'
            : 'border-slate-700 bg-slate-950/50'
        }`}
      >
        <p className="text-sm text-white whitespace-pre-wrap break-words leading-snug">{q.body}</p>
        <p className="text-[11px] text-slate-500">
          <span className="text-slate-400">{q.author_name || 'Anonymous'}</span>
          <span className="mx-1">·</span>
          {formatWhen(q.created_at)}
          {lane === 'queue' && q.sort_order ? (
            <>
              <span className="mx-1">·</span>
              <span className="text-fuchsia-300">#{q.sort_order}</span>
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {lane === 'inbox' ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runPatch(q.id, { status: 'approved' })}
                className="px-2 py-1 text-[11px] font-semibold rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runPatch(q.id, { is_queued: true })}
                className="px-2 py-1 text-[11px] font-semibold rounded bg-fuchsia-700 hover:bg-fuchsia-600 disabled:opacity-50"
              >
                Queue
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runPatch(q.id, { status: 'rejected' })}
                className="px-2 py-1 text-[11px] font-semibold rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
              >
                Reject
              </button>
            </>
          ) : null}

          {lane === 'ready' ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runPatch(q.id, { is_queued: true })}
                className="px-2 py-1 text-[11px] font-semibold rounded bg-fuchsia-700 hover:bg-fuchsia-600 disabled:opacity-50"
              >
                Add to queue
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runPatch(q.id, { status: 'answered' })}
                className="px-2 py-1 text-[11px] font-semibold rounded bg-sky-800 hover:bg-sky-700 disabled:opacity-50"
              >
                Answered
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runPatch(q.id, { status: 'rejected' })}
                className="px-2 py-1 text-[11px] font-semibold rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
              >
                Reject
              </button>
            </>
          ) : null}

          {lane === 'queue' ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void moveInQueue(q.id, -1)}
                className="px-2 py-1 text-[11px] font-semibold rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void moveInQueue(q.id, 1)}
                className="px-2 py-1 text-[11px] font-semibold rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
                title="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runPatch(q.id, { status: 'answered', is_queued: false })}
                className="px-2 py-1 text-[11px] font-semibold rounded bg-sky-800 hover:bg-sky-700 disabled:opacity-50"
              >
                Answered
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runPatch(q.id, { is_queued: false })}
                className="px-2 py-1 text-[11px] font-semibold rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
              >
                Unqueue
              </button>
            </>
          ) : null}

          {lane === 'done' ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runPatch(q.id, { status: 'approved', is_queued: false })}
                className="px-2 py-1 text-[11px] font-semibold rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
              >
                Restore
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(q.id)}
                className="px-2 py-1 text-[11px] font-semibold rounded border border-slate-600 text-slate-400 hover:bg-slate-800 disabled:opacity-50"
              >
                Delete
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove(q.id)}
              className="ml-auto px-2 py-1 text-[11px] font-semibold rounded text-slate-500 hover:text-rose-300 hover:bg-rose-950/40 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </li>
    );
  };

  const lane = (
    id: LaneId,
    title: string,
    hint: string,
    items: WebQaQuestion[],
    accent: string
  ) => (
    <section className={`rounded-xl border ${accent} bg-slate-900/60 flex flex-col min-h-[18rem]`}>
      <header className="px-3 py-2.5 border-b border-slate-800/80">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <span className="text-xs tabular-nums text-slate-400">{items.length}</span>
        </div>
        <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>
      </header>
      <div className="p-2.5 flex-1 overflow-y-auto max-h-[calc(100vh-14rem)]">
        {items.length === 0 ? (
          <p className="text-xs text-slate-600 text-center py-8">Empty</p>
        ) : (
          <ul className="space-y-2">{items.map((q) => renderCard(q, id))}</ul>
        )}
      </div>
    </section>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-900/90 sticky top-0 z-20">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-fuchsia-300/90 font-semibold">
              Active Q&A
              {inbox.length > 0 ? (
                <span className="ml-2 inline-flex items-center rounded-full bg-amber-600/40 border border-amber-500/50 px-2 py-0.5 text-[10px] text-amber-50 normal-case tracking-normal">
                  {inbox.length} inbox
                </span>
              ) : null}
              {queue.length > 0 ? (
                <span className="ml-2 inline-flex items-center rounded-full bg-fuchsia-600/40 border border-fuchsia-500/50 px-2 py-0.5 text-[10px] text-fuchsia-50 normal-case tracking-normal">
                  {queue.length} queued
                </span>
              ) : null}
            </p>
            <h1 className="text-xl font-bold leading-tight">{eventName}</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Submissions {session?.is_open ? 'OPEN' : 'CLOSED'}
              <span className="mx-1.5 text-slate-600">·</span>
              Queue = selected for showcase
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate(`/qa-mod?${qs}`)}
              className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600"
            >
              Management
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/run-of-show?eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(eventName)}`
                )
              }
              className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600"
            >
              Back to ROS
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 py-4 space-y-4">
        {loading && questions.length === 0 ? (
          <p className="text-slate-400">Loading moderation board…</p>
        ) : error ? (
          <div className="rounded-lg border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {lane(
            'inbox',
            'Inbox',
            'New submissions — approve, queue, or reject',
            inbox,
            'border-amber-700/40'
          )}
          {lane(
            'ready',
            'Ready',
            'Approved — add to showcase queue when you want them live',
            ready,
            'border-emerald-700/40'
          )}
          {lane(
            'queue',
            'Showcase queue',
            'Selected order for future on-screen display',
            queue,
            'border-fuchsia-600/50'
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-slate-800/40 rounded-xl"
          >
            <span className="text-sm font-semibold text-slate-300">
              Done
              <span className="ml-2 text-xs font-normal text-slate-500 tabular-nums">
                {done.length} answered / rejected
              </span>
            </span>
            <span className="text-slate-500 text-xs">{showDone ? 'Hide' : 'Show'}</span>
          </button>
          {showDone ? (
            <div className="px-3 pb-3">
              {done.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-4">Nothing here yet</p>
              ) : (
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {done.map((q) => renderCard(q, 'done'))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
