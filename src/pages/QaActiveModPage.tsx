import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  deleteWebQaQuestion,
  fetchWebQaQuestions,
  fetchWebQaSession,
  patchWebQaQuestion,
  type WebQaQuestion,
  type WebQaSession,
  type WebQaStatus,
} from '../lib/webQa';

type FilterTab = 'pending' | 'approved' | 'queued' | 'answered' | 'rejected' | 'all';

const TABS: { id: FilterTab; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'queued', label: 'Queued' },
  { id: 'answered', label: 'Answered' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
];

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function statusPillClass(status: string): string {
  switch (status) {
    case 'pending':
      return 'bg-amber-600/30 text-amber-100 border-amber-500/50';
    case 'approved':
      return 'bg-emerald-600/30 text-emerald-100 border-emerald-500/50';
    case 'answered':
      return 'bg-sky-600/30 text-sky-100 border-sky-500/50';
    case 'rejected':
      return 'bg-rose-600/30 text-rose-100 border-rose-500/50';
    default:
      return 'bg-slate-600/40 text-slate-200 border-slate-500/50';
  }
}

function isQueued(q: WebQaQuestion): boolean {
  return q.is_queued === true;
}

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
  const [tab, setTab] = useState<FilterTab>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  const counts = useMemo(() => {
    const c = {
      pending: 0,
      approved: 0,
      queued: 0,
      answered: 0,
      rejected: 0,
      all: questions.length,
    };
    for (const q of questions) {
      if (isQueued(q)) c.queued += 1;
      if (q.status === 'pending') c.pending += 1;
      else if (q.status === 'approved') c.approved += 1;
      else if (q.status === 'answered') c.answered += 1;
      else if (q.status === 'rejected') c.rejected += 1;
    }
    return c;
  }, [questions]);

  const visible = useMemo(() => {
    if (tab === 'all') return questions;
    if (tab === 'queued') {
      return questions
        .filter((q) => isQueued(q))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    }
    return questions.filter((q) => q.status === tab);
  }, [questions, tab]);

  const setStatus = async (id: string, status: WebQaStatus) => {
    setBusyId(id);
    try {
      const updated = await patchWebQaQuestion(id, {
        status,
        moderated_by: moderator,
      });
      setQuestions((prev) => prev.map((q) => (q.id === id ? updated : q)));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  const setQueued = async (id: string, queued: boolean) => {
    setBusyId(id);
    try {
      const updated = await patchWebQaQuestion(id, {
        is_queued: queued,
        moderated_by: moderator,
      });
      setQuestions((prev) => prev.map((q) => (q.id === id ? updated : q)));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Queue update failed');
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

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-900/90 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-fuchsia-300/90 font-semibold">
              Active Q&A
              {counts.pending > 0 ? (
                <span className="ml-2 inline-flex items-center rounded-full bg-amber-600/40 border border-amber-500/50 px-2 py-0.5 text-[10px] text-amber-50 normal-case tracking-normal">
                  {counts.pending} pending
                </span>
              ) : null}
            </p>
            <h1 className="text-xl font-bold leading-tight">{eventName}</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Submissions: {session?.is_open ? 'OPEN' : 'CLOSED'} (follows current Q&A cue)
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => window.open(`/qa-mod/select?${qs}`, '_blank')}
              className="px-3 py-1.5 text-sm rounded bg-fuchsia-700 hover:bg-fuchsia-600"
            >
              Select
            </button>
            <button
              type="button"
              onClick={() => window.open(`/qa-mod/read?${qs}`, '_blank')}
              className="px-3 py-1.5 text-sm rounded bg-sky-700 hover:bg-sky-600"
            >
              Reader
            </button>
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
              onClick={() => {
                let role: string | undefined;
                try {
                  role = localStorage.getItem(`userRole_${eventId}`) || undefined;
                } catch {
                  /* ignore */
                }
                navigate(
                  `/run-of-show?eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(eventName)}`,
                  {
                    state: {
                      event: {
                        id: eventId,
                        name: eventName || 'Event',
                        date: new Date().toISOString(),
                        location: '',
                        numberOfDays: 1,
                      },
                      userRole: role,
                    },
                  }
                );
              }}
              className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600"
            >
              Back to ROS
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-full text-sm border ${
                tab === t.id
                  ? 'bg-fuchsia-700/40 border-fuchsia-500 text-white'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-slate-400 tabular-nums">{counts[t.id] ?? 0}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-slate-400">Loading moderation queue…</p>
        ) : error ? (
          <div className="rounded-lg border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-rose-100">
            {error}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 px-6 py-12 text-center text-slate-400">
            No {tab === 'all' ? '' : tab} questions yet.
            {session?.is_open
              ? ' Audience can submit while a Q&A cue is loaded.'
              : ' Submissions are closed.'}
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((q) => (
              <li
                key={q.id}
                className={`rounded-xl border px-4 py-3 space-y-3 ${
                  isQueued(q)
                    ? 'border-fuchsia-600/40 bg-fuchsia-950/20'
                    : 'border-slate-700 bg-slate-900/70'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-base text-white whitespace-pre-wrap break-words">{q.body}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {q.author_name ? (
                        <span className="text-slate-300">{q.author_name}</span>
                      ) : (
                        <span>Anonymous</span>
                      )}
                      <span className="mx-1.5 text-slate-600">·</span>
                      {formatWhen(q.created_at)}
                      {isQueued(q) ? (
                        <>
                          <span className="mx-1.5 text-slate-600">·</span>
                          <span className="text-fuchsia-300">
                            Queued{q.sort_order ? ` #${q.sort_order}` : ''}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded border text-[11px] font-semibold uppercase tracking-wide ${statusPillClass(
                      q.status
                    )}`}
                  >
                    {q.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {q.status !== 'approved' ? (
                    <button
                      type="button"
                      disabled={busyId === q.id}
                      onClick={() => void setStatus(q.id, 'approved')}
                      className="px-2.5 py-1 text-xs font-semibold rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
                    >
                      Approve
                    </button>
                  ) : null}
                  {!isQueued(q) ? (
                    <button
                      type="button"
                      disabled={busyId === q.id}
                      onClick={() => void setQueued(q.id, true)}
                      className="px-2.5 py-1 text-xs font-semibold rounded bg-fuchsia-700 hover:bg-fuchsia-600 disabled:opacity-50"
                    >
                      Queue
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === q.id}
                      onClick={() => void setQueued(q.id, false)}
                      className="px-2.5 py-1 text-xs font-semibold rounded border border-fuchsia-500/50 text-fuchsia-100 hover:bg-fuchsia-900/40 disabled:opacity-50"
                    >
                      Unqueue
                    </button>
                  )}
                  {q.status !== 'answered' ? (
                    <button
                      type="button"
                      disabled={busyId === q.id}
                      onClick={() => void setStatus(q.id, 'answered')}
                      className="px-2.5 py-1 text-xs font-semibold rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50"
                    >
                      Mark answered
                    </button>
                  ) : null}
                  {q.status !== 'rejected' ? (
                    <button
                      type="button"
                      disabled={busyId === q.id}
                      onClick={() => void setStatus(q.id, 'rejected')}
                      className="px-2.5 py-1 text-xs font-semibold rounded bg-rose-800 hover:bg-rose-700 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  ) : null}
                  {q.status !== 'pending' ? (
                    <button
                      type="button"
                      disabled={busyId === q.id}
                      onClick={() => void setStatus(q.id, 'pending')}
                      className="px-2.5 py-1 text-xs font-semibold rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
                    >
                      Back to pending
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busyId === q.id}
                    onClick={() => void remove(q.id)}
                    className="px-2.5 py-1 text-xs font-semibold rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
